import { randomUUID } from "node:crypto";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const PROCESSING_PREFIX = ".jukie-processing-";

// Directory entries on disk are arbitrary bytes; Node's default "utf8" string decoding is lossy
// for anything that isn't valid UTF-8 (common for files copied from Windows/legacy codepages),
// silently replacing bad bytes with U+FFFD. Once that happens the original bytes are gone and any
// path built from the decoded name can no longer match the real file, causing ENOENT.
//
// "latin1" decodes bytes 1:1 to code points and is fully reversible, so we use it as our internal
// byte-safe string representation for path bookkeeping (join/extname/relative all still work fine
// on it), then convert back to a raw Buffer with toRawPath() right before every actual fs call.
function toRawPath(pathLike) {
  return Buffer.isBuffer(pathLike) ? pathLike : Buffer.from(pathLike, "latin1");
}

function readRawDir(pathLike, options) {
  return readdir(toRawPath(pathLike), { ...options, encoding: "latin1" });
}

// Windows-1252 differs from latin1 only in the 0x80-0x9F range (latin1 maps those to invisible C1
// control codes). Recovering it gives a much more readable fallback title for filenames that came
// from Windows tools/zips without being transcoded to UTF-8.
const CP1252_HIGH_BYTES = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…",
  0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8A: "Š",
  0x8B: "‹", 0x8C: "Œ", 0x8E: "Ž", 0x91: "‘", 0x92: "’",
  0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9A: "š", 0x9B: "›", 0x9C: "œ",
  0x9E: "ž", 0x9F: "Ÿ"
};

// Best-effort human-readable recovery of a byte-safe (latin1) filename string: keep it as real
// UTF-8 when the bytes are valid UTF-8, otherwise assume the common Windows-1252 case.
export function decodeFilenameForDisplay(rawPathString) {
  const bytes = toRawPath(rawPathString);
  const asUtf8 = bytes.toString("utf8");
  if (Buffer.from(asUtf8, "utf8").equals(bytes)) return asUtf8;
  let out = "";
  for (const byte of bytes) out += CP1252_HIGH_BYTES[byte] || String.fromCharCode(byte);
  return out;
}

export async function findImportableFiles(folderPath, allowedExtensions) {
  const files = [];

  async function walk(currentPath) {
    const entries = await readRawDir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase())) {
        const details = await stat(toRawPath(entryPath));
        files.push({
          path: entryPath,
          relativePath: relative(folderPath, entryPath),
          size: details.size,
          modifiedAt: details.mtimeMs
        });
      }
    }
  }

  await walk(folderPath);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true, sensitivity: "base" })
  );
}

function fingerprintFiles(files) {
  return files.map((file) => `${file.relativePath}\0${file.size}\0${file.modifiedAt}`).join("\n");
}

export function createFolderImporter({
  importDir,
  allowedExtensions,
  settleMs,
  pollMs,
  recoverImports,
  beginImport,
  abortImport,
  finishImport,
  importFolder,
  logger
}) {
  const folderStates = new Map();
  let timer = null;
  let stopped = true;
  let scanning = false;

  async function scanOnce() {
    if (scanning) return;
    scanning = true;

    try {
      await recoverImports();
      const entries = await readRawDir(importDir, { withFileTypes: true });
      const activePaths = new Set();

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.endsWith(".uploading")) continue;
        const folderPath = join(importDir, entry.name);
        activePaths.add(folderPath);

        try {
          const files = await findImportableFiles(folderPath, allowedExtensions);
          if (!files.length) {
            folderStates.delete(folderPath);
            continue;
          }

          const fingerprint = fingerprintFiles(files);
          const previous = folderStates.get(folderPath);
          if (!previous || previous.fingerprint !== fingerprint) {
            folderStates.set(folderPath, { fingerprint, stableSince: Date.now() });
            continue;
          }
          if (Date.now() - previous.stableSince < settleMs) continue;

          const importId = randomUUID();
          const rawMoodName = basename(folderPath);
          const moodName = decodeFilenameForDisplay(rawMoodName);
          const workingName = `${PROCESSING_PREFIX}${importId}`;
          const workingPath = join(importDir, workingName);
          await beginImport({ importId, sourceName: moodName, workingName });

          try {
            await rename(toRawPath(folderPath), toRawPath(workingPath));
            const ownedFiles = await findImportableFiles(workingPath, allowedExtensions);
            if (fingerprintFiles(ownedFiles) !== fingerprint) {
              throw new Error("Folder changed while the importer was taking ownership");
            }
            await importFolder({ importId, folderPath: workingPath, moodName, files: ownedFiles });
          } catch (error) {
            const workingExists = await stat(toRawPath(workingPath)).then(() => true).catch(() => false);
            let restored = !workingExists;
            if (workingExists) {
              const sourceExists = await stat(toRawPath(folderPath)).then(() => true).catch(() => false);
              const recoveryPath = sourceExists
                ? join(importDir, `${rawMoodName}-recovered-${importId.slice(0, 8)}`)
                : folderPath;
              try {
                await rename(toRawPath(workingPath), toRawPath(recoveryPath));
                restored = true;
              } catch (restoreError) {
                logger.error({ error: restoreError, workingPath }, "Failed import source will be recovered on the next scan");
              }
            }
            if (restored) await abortImport(importId);
            throw error;
          }

          folderStates.delete(folderPath);
          try {
            await rm(toRawPath(workingPath), { recursive: true, force: true });
            await finishImport(importId);
          } catch (error) {
            logger.error({ error, workingPath }, "Imported folder cleanup will be retried on startup");
          }
        } catch (error) {
          folderStates.set(folderPath, {
            fingerprint: folderStates.get(folderPath)?.fingerprint || "",
            stableSince: Date.now()
          });
          logger.error({ error, folderPath }, "Folder import failed; source folder retained for retry");
        }
      }

      for (const folderPath of folderStates.keys()) {
        if (!activePaths.has(folderPath)) folderStates.delete(folderPath);
      }
    } finally {
      scanning = false;
    }
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await scanOnce();
      } catch (error) {
        logger.error({ error, importDir }, "Folder import scan failed");
      } finally {
        schedule();
      }
    }, pollMs);
    timer.unref?.();
  }

  async function start() {
    if (!stopped) return;
    stopped = false;
    await scanOnce();
    schedule();
  }

  async function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    while (scanning) await sleep(100);
  }

  return { start, stop, scanOnce };
}
