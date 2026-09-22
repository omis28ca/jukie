import { existsSync } from "node:fs";
import { copyFile, readdir, rename, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { runtime } from "../runtime.js";
import { EMPTY_METADATA, extractEmbeddedArtwork, getMimeTypeForExtension, probeAudioMetadata } from "../media/metadata.js";
import { createFolderImporter, findImportableFiles, decodeFilenameForDisplay } from "./folder-importer.js";

async function stageImportedSong(sourcePath, importId) {
  // sourcePath is a byte-preserving (latin1) string from findImportableFiles, not necessarily valid
  // UTF-8 text. Convert it back to raw bytes for the filesystem call and decode a display-safe copy
  // for the title fallback.
  const extension = extname(sourcePath).toLowerCase();
  const sourceBaseName = decodeFilenameForDisplay(basename(sourcePath, extension));
  const safeBaseName = sourceBaseName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "media";
  const songId = randomUUID();
  const storedFilename = `${importId}-${songId}-${safeBaseName}${extension}`;
  const storedPath = join(config.uploadDir, storedFilename);
  let extractedArtwork = null;

  try {
    await copyFile(Buffer.from(sourcePath, "latin1"), storedPath);
    const metadata = (await probeAudioMetadata(storedPath)) || EMPTY_METADATA;
    extractedArtwork = metadata.hasEmbeddedArtwork
      ? await extractEmbeddedArtwork(storedPath, `${importId}-${randomUUID()}`)
      : null;

    return {
      id: songId,
      data: {
        id: songId,
        title: metadata.title || sourceBaseName,
        artist: metadata.artist || null,
        album: metadata.album || null,
        genre: metadata.genre || null,
        year: metadata.year,
        uploadedBy: "Folder import",
        filename: storedFilename,
        path: storedPath,
        mimeType: getMimeTypeForExtension(extension),
        artworkFilename: extractedArtwork?.artworkFilename || null,
        artworkMimeType: extractedArtwork?.artworkMimeType || null,
        artworkPath: extractedArtwork?.artworkPath || null,
        duration: metadata.duration
      },
      path: storedPath,
      artworkPath: extractedArtwork?.artworkPath || null
    };
  } catch (error) {
    await Promise.all([
      rm(storedPath, { force: true }).catch(() => {}),
      extractedArtwork?.artworkPath ? rm(extractedArtwork.artworkPath, { force: true }).catch(() => {}) : null
    ]);
    throw error;
  }
}

async function removeStagedFiles(songs) {
  await Promise.all(
    songs.flatMap((song) => [
      rm(song.path, { force: true }).catch(() => {}),
      song.artworkPath ? rm(song.artworkPath, { force: true }).catch(() => {}) : Promise.resolve()
    ])
  );
}

async function cleanupImportFiles(importId) {
  for (const directory of [config.uploadDir, config.artworkDir]) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(`${importId}-`))
        .map((entry) => rm(join(directory, entry.name), { force: true }).catch(() => {}))
    );
  }
}

async function importFolderAsMood({ importId, folderPath, moodName, files }) {
  const logger = runtime.logger;
  if (files.length > config.maxMoodSongs) {
    throw new Error(`Folder contains ${files.length} songs; the maximum is ${config.maxMoodSongs}`);
  }

  logger.info?.({ folderPath, moodName, songCount: files.length }, "Importing folder as mood");
  const songs = [];

  try {
    for (const file of files) {
      songs.push(await stageImportedSong(file.path, importId));
    }

    const currentFiles = await findImportableFiles(folderPath, config.allowedAudioExtensions);
    const folderChanged =
      currentFiles.length !== files.length ||
      currentFiles.some((file, index) => {
        const original = files[index];
        return (
          !original ||
          file.relativePath !== original.relativePath ||
          file.size !== original.size ||
          file.modifiedAt !== original.modifiedAt
        );
      });
    if (folderChanged) {
      throw new Error("Folder changed during import; it will be retried when copying is complete");
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.song.createMany({ data: songs.map((song) => song.data) });
        const existingMood = await tx.mood.findFirst({
          where: { name: moodName },
          orderBy: { createdAt: "asc" },
          select: { id: true }
        });

        if (existingMood) {
          await tx.moodSong.deleteMany({ where: { moodId: existingMood.id } });
          await tx.mood.update({ where: { id: existingMood.id }, data: { updatedAt: new Date() } });
          await tx.moodSong.createMany({
            data: songs.map((song, position) => ({ moodId: existingMood.id, songId: song.id, position }))
          });
        } else {
          const mood = await tx.mood.create({ data: { name: moodName } });
          await tx.moodSong.createMany({
            data: songs.map((song, position) => ({ moodId: mood.id, songId: song.id, position }))
          });
        }

        await tx.folderImport.update({ where: { id: importId }, data: { status: "completed" } });
      },
      { timeout: 300000 }
    );
  } catch (error) {
    await removeStagedFiles(songs);
    throw error;
  }

  try {
    runtime.realtime.io.emit("songs:updated");
    await runtime.realtime.broadcastMoods();
  } catch (error) {
    logger.error?.({ error, importId }, "Folder imported, but realtime notification failed");
  }
  logger.info?.({ folderPath, moodName, songCount: songs.length }, "Folder import completed");
}

async function beginFolderImport({ importId, sourceName, workingName }) {
  await prisma.folderImport.create({ data: { id: importId, sourceName, workingName } });
}

async function abortFolderImport(importId) {
  await cleanupImportFiles(importId);
  await prisma.folderImport.deleteMany({ where: { id: importId, status: "processing" } });
}

async function finishFolderImport(importId) {
  await prisma.folderImport.delete({ where: { id: importId } });
}

export async function recoverFolderImports() {
  const logger = runtime.logger;
  const imports = await prisma.folderImport.findMany({ orderBy: { createdAt: "asc" } });

  for (const folderImport of imports) {
    const sourcePath = join(config.importDir, folderImport.sourceName);
    const workingPath = join(config.importDir, folderImport.workingName);

    if (folderImport.status === "completed") {
      try {
        await rm(workingPath, { recursive: true, force: true });
        await prisma.folderImport.delete({ where: { id: folderImport.id } });
      } catch (error) {
        logger.error?.({ error, workingPath }, "Completed folder import cleanup failed");
      }
      continue;
    }

    await cleanupImportFiles(folderImport.id);
    if (existsSync(workingPath)) {
      const recoveryPath = existsSync(sourcePath)
        ? join(config.importDir, `${folderImport.sourceName}-recovered-${folderImport.id.slice(0, 8)}`)
        : sourcePath;
      await rename(workingPath, recoveryPath);
    }
    await prisma.folderImport.delete({ where: { id: folderImport.id } });
  }
}

export function createImportWatcher(logger) {
  return createFolderImporter({
    importDir: config.importDir,
    allowedExtensions: config.allowedAudioExtensions,
    settleMs: config.importSettleMs,
    pollMs: config.importPollMs,
    recoverImports: recoverFolderImports,
    beginImport: beginFolderImport,
    abortImport: abortFolderImport,
    finishImport: finishFolderImport,
    importFolder: importFolderAsMood,
    logger
  });
}
