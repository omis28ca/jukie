import { randomUUID } from "node:crypto";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const PROCESSING_PREFIX = ".jukie-processing-";

export async function findImportableFiles(folderPath, allowedExtensions) {
  const files = [];

  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase())) {
        const details = await stat(entryPath);
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
      const entries = await readdir(importDir, { withFileTypes: true });
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
          const moodName = basename(folderPath);
          const workingName = `${PROCESSING_PREFIX}${importId}`;
          const workingPath = join(importDir, workingName);
          await beginImport({ importId, sourceName: moodName, workingName });

          try {
            await rename(folderPath, workingPath);
            const ownedFiles = await findImportableFiles(workingPath, allowedExtensions);
            if (fingerprintFiles(ownedFiles) !== fingerprint) {
              throw new Error("Folder changed while the importer was taking ownership");
            }
            await importFolder({ importId, folderPath: workingPath, moodName, files: ownedFiles });
          } catch (error) {
            const workingExists = await stat(workingPath).then(() => true).catch(() => false);
            let restored = !workingExists;
            if (workingExists) {
              const sourceExists = await stat(folderPath).then(() => true).catch(() => false);
              const recoveryPath = sourceExists
                ? join(importDir, `${moodName}-recovered-${importId.slice(0, 8)}`)
                : folderPath;
              try {
                await rename(workingPath, recoveryPath);
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
            await rm(workingPath, { recursive: true, force: true });
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
