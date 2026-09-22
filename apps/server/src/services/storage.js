import { constants } from "node:fs";
import { access, mkdir, copyFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { config, SETTING_KEYS, STORAGE_SUBDIRS } from "../config.js";
import { prisma } from "../db.js";
import { httpError } from "../lib/http.js";
import { runtime } from "../runtime.js";
import { getSetting, setSetting } from "./settings.js";

const IS_WIN = platform() === "win32";
const PROBE_FILE = ".jukie-write-test";

function normalizeRoot(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw httpError(400, "root is required");
  if (!isAbsolute(raw)) throw httpError(400, "root must be an absolute path");
  return normalize(resolve(raw)).replace(/[\\/]+$/, "") || raw;
}

export function dirsForRoot(root) {
  return {
    storageRoot: root,
    uploadDir: join(root, STORAGE_SUBDIRS.uploadDir),
    artworkDir: join(root, STORAGE_SUBDIRS.artworkDir),
    importDir: join(root, STORAGE_SUBDIRS.importDir)
  };
}

function applyDirs(dirs) {
  config.storageRoot = dirs.storageRoot;
  config.uploadDir = dirs.uploadDir;
  config.artworkDir = dirs.artworkDir;
  config.importDir = dirs.importDir;
}

async function ensureWritable(dirs) {
  for (const directory of [dirs.uploadDir, dirs.artworkDir, dirs.importDir]) {
    try {
      await mkdir(directory, { recursive: true });
    } catch (error) {
      throw httpError(400, `Cannot create ${directory}: ${error.message}`);
    }
  }

  const probe = join(dirs.uploadDir, PROBE_FILE);
  try {
    await writeFile(probe, "ok");
  } catch (error) {
    throw httpError(400, `${dirs.uploadDir} is not writable: ${error.message}`);
  } finally {
    await rm(probe, { force: true }).catch(() => {});
  }
}

async function diskUsage(targetPath) {
  // statfs needs an existing path — walk up until one is found.
  let probe = targetPath;
  while (probe && !existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  try {
    const info = await statfs(probe);
    const totalBytes = info.blocks * info.bsize;
    const freeBytes = info.bavail * info.bsize;
    return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
  } catch {
    return { totalBytes: null, freeBytes: null, usedBytes: null };
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Candidate drives/mount points the admin can pick from, each with its free space. */
export async function listVolumes() {
  const candidates = new Set();

  if (IS_WIN) {
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:${sep}`;
      if (existsSync(drive)) candidates.add(drive);
    }
  } else {
    candidates.add("/");
    for (const parent of ["/mnt", "/media", "/srv", "/run/media"]) {
      const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const mount = join(parent, entry.name);
        const nested = await readdir(mount, { withFileTypes: true }).catch(() => []);
        // /run/media/<user>/<volume> and /media/<user>/<volume> nest one level deeper.
        const isUserDir = ["/media", "/run/media"].includes(parent) && nested.some((child) => child.isDirectory());
        if (isUserDir) for (const child of nested.filter((c) => c.isDirectory())) candidates.add(join(mount, child.name));
        else candidates.add(mount);
      }
    }
    candidates.add(homedir());
  }

  candidates.add(parse(config.storageRoot).root);

  const volumes = [];
  for (const path of candidates) {
    if (!(await isDirectory(path))) continue;
    const usage = await diskUsage(path);
    volumes.push({
      path,
      suggestedRoot: join(path, "jukie-music"),
      ...usage,
      writable: await access(path, constants.W_OK).then(() => true).catch(() => false)
    });
  }

  return volumes.sort((a, b) => a.path.localeCompare(b.path));
}

export async function describeStorage({ includeVolumes = true } = {}) {
  const override = await getSetting(SETTING_KEYS.storageRoot);

  return {
    root: config.storageRoot,
    source: override ? "setting" : "environment",
    isDefault: config.storageRoot === config.envStorage.root,
    defaultRoot: config.envStorage.root,
    uploadDir: config.uploadDir,
    artworkDir: config.artworkDir,
    importDir: config.importDir,
    disk: await diskUsage(config.storageRoot),
    ...(includeVolumes ? { volumes: await listVolumes() } : {})
  };
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}

async function moveEntries(fromDir, toDir, logger) {
  const entries = await readdir(fromDir, { withFileTypes: true }).catch(() => []);
  let movedCount = 0;

  for (const entry of entries) {
    const from = join(fromDir, entry.name);
    const to = join(toDir, entry.name);
    if (existsSync(to)) continue;

    try {
      await rename(from, to);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      // Different volume: copy then delete.
      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true });
        movedCount += await moveEntries(from, to, logger);
        await rm(from, { recursive: true, force: true });
        continue;
      }
      await copyFile(from, to);
      await rm(from, { force: true });
    }
    movedCount += 1;
  }

  return movedCount;
}

/** Rewrites the absolute paths stored on songs so they point at the new location. */
async function repointSongPaths(previous, next) {
  const songs = await prisma.song.findMany({ select: { id: true, path: true, artworkPath: true } });
  let updatedCount = 0;

  for (const song of songs) {
    const data = {};
    if (song.path && isInside(song.path, previous.uploadDir)) {
      data.path = join(next.uploadDir, relative(previous.uploadDir, song.path));
    }
    if (song.artworkPath && isInside(song.artworkPath, previous.artworkDir)) {
      data.artworkPath = join(next.artworkDir, relative(previous.artworkDir, song.artworkPath));
    }
    if (!Object.keys(data).length) continue;

    await prisma.song.update({ where: { id: song.id }, data });
    updatedCount += 1;
  }

  return updatedCount;
}

async function restartImporter(logger) {
  const importer = runtime.folderImporter;
  if (!importer) return;

  try {
    await importer.stop();
    // The watcher captures importDir when it is created, so build a fresh one for the new drive.
    const { createImportWatcher } = await import("./imports.js");
    const next = createImportWatcher(logger);
    runtime.folderImporter = next;
    await next.start();
    logger?.info?.({ importDir: config.importDir }, "Folder import inbox restarted on the new drive");
  } catch (error) {
    logger?.error?.({ error }, "Failed to restart the folder import watcher");
  }
}

/**
 * Applies the persisted storage root at boot. Falls back to the environment layout when the saved
 * drive is missing (an unplugged USB disk should not stop the jukebox from starting).
 */
export async function loadStorageRoot(logger = runtime.logger) {
  const saved = await getSetting(SETTING_KEYS.storageRoot).catch(() => null);
  if (!saved) return { root: config.storageRoot, source: "environment" };

  const dirs = dirsForRoot(saved);
  try {
    await ensureWritable(dirs);
  } catch (error) {
    logger?.warn?.(
      { savedRoot: saved, fallback: config.envStorage.root, error: error.message },
      "Configured music storage drive is unavailable; falling back to the default location"
    );
    return { root: config.storageRoot, source: "environment", unavailableRoot: saved };
  }

  applyDirs(dirs);
  logger?.info?.({ storageRoot: config.storageRoot }, "Using the configured music storage drive");
  return { root: config.storageRoot, source: "setting" };
}

/**
 * Points the library at another drive/folder. With `move: true` the existing uploads, artwork and
 * pending imports are relocated and every stored song path is rewritten.
 */
export async function setStorageRoot({ root, move = false, useDefault = false } = {}, logger = runtime.logger) {
  if (typeof move !== "boolean") throw httpError(400, "move must be a boolean");

  const targetRoot = useDefault ? config.envStorage.root : normalizeRoot(root);
  const previous = {
    storageRoot: config.storageRoot,
    uploadDir: config.uploadDir,
    artworkDir: config.artworkDir,
    importDir: config.importDir
  };

  if (targetRoot === previous.storageRoot) {
    await setSetting(SETTING_KEYS.storageRoot, useDefault ? null : targetRoot);
    return { ok: true, movedCount: 0, repointedCount: 0, unchanged: true, ...(await describeStorage()) };
  }

  if (isInside(targetRoot, previous.storageRoot)) {
    throw httpError(400, "The new location cannot be inside the current storage folder");
  }

  const next = dirsForRoot(targetRoot);
  await ensureWritable(next);

  let movedCount = 0;
  let repointedCount = 0;

  if (move) {
    const playing = await prisma.queueItem.count({ where: { status: "playing" } });
    if (playing) throw httpError(409, "Stop playback before moving the music library");

    for (const key of ["uploadDir", "artworkDir", "importDir"]) {
      movedCount += await moveEntries(previous[key], next[key], logger);
    }
    repointedCount = await repointSongPaths(previous, next);
  }

  applyDirs(next);
  await setSetting(SETTING_KEYS.storageRoot, useDefault ? null : targetRoot);
  await restartImporter(logger);

  logger?.info?.({ from: previous.storageRoot, to: targetRoot, movedCount, repointedCount }, "Music storage location changed");
  runtime.realtime?.io?.emit("storage:updated", { root: targetRoot });

  return { ok: true, movedCount, repointedCount, previousRoot: previous.storageRoot, ...(await describeStorage()) };
}
