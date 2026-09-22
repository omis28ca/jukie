import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { httpError } from "../lib/http.js";
import { mapSong } from "../lib/serializers.js";
import { runtime } from "../runtime.js";
import { EMPTY_METADATA, extractEmbeddedArtwork, probeAudioMetadata } from "../media/metadata.js";

export async function listSongs({ search = "", genre = "" } = {}) {
  const term = String(search || "").trim();
  const normalizedGenre = String(genre || "").trim();

  // SQLite `contains` is case-insensitive for ASCII, which is what the library search needs.
  const where = {
    AND: [
      term
        ? {
            OR: [
              { title: { contains: term } },
              { artist: { contains: term } },
              { album: { contains: term } },
              { genre: { contains: term } }
            ]
          }
        : {},
      normalizedGenre ? { genre: normalizedGenre } : {}
    ]
  };

  const songs = await prisma.song.findMany({ where, orderBy: { createdAt: "desc" } });
  return songs.map(mapSong);
}

export async function listGenres() {
  const rows = await prisma.song.findMany({
    where: { genre: { not: null } },
    distinct: ["genre"],
    select: { genre: true },
    orderBy: { genre: "asc" }
  });
  return rows.map((row) => row.genre).filter(Boolean);
}

export async function getSongOrThrow(songId, select) {
  const id = typeof songId === "string" ? songId.trim() : "";
  if (!id) throw httpError(400, "songId is required");

  const song = await prisma.song.findUnique({ where: { id }, ...(select ? { select } : {}) });
  if (!song) throw httpError(404, "Song not found");
  return song;
}

/**
 * Consumes a multipart request, stores the media file, scans metadata/artwork, and records
 * the song.
 */
export async function storeUpload(request) {
  const parts = request.parts();

  let originalFilename = null;
  let mimeType = null;
  let fileCount = 0;
  let storedFilename = null;
  let storedPath = null;
  let truncated = false;
  const fields = {};

  try {
    for await (const part of parts) {
      if (part.type !== "file") {
        fields[part.fieldname] = part.value;
        continue;
      }

      fileCount += 1;
      if (fileCount > 1) {
        part.file.resume();
        continue;
      }

      originalFilename = part.filename;
      mimeType = part.mimetype;
      const extension = extname(originalFilename || "").toLowerCase();
      if (!config.allowedAudioExtensions.has(extension)) {
        part.file.resume();
        throw httpError(400, "Unsupported media file type");
      }

      const safeBaseName =
        basename(originalFilename, extension).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "media";
      storedFilename = `${randomUUID()}-${safeBaseName}${extension}`;
      storedPath = join(config.uploadDir, storedFilename);
      await pipeline(part.file, createWriteStream(storedPath));
      truncated = part.file.truncated;
    }
  } catch (error) {
    if (storedPath) await rm(storedPath, { force: true }).catch(() => {});
    throw error;
  }

  if (truncated) {
    await rm(storedPath, { force: true });
    throw httpError(413, `Upload exceeds ${Math.floor(config.uploadMaxBytes / (1024 * 1024))}MB limit`);
  }

  if (fileCount !== 1 || !storedPath || !originalFilename) {
    if (storedPath) await rm(storedPath, { force: true });
    throw httpError(400, fileCount > 1 ? "Exactly one media file is required" : "Media file is required");
  }

  const extension = extname(originalFilename).toLowerCase();
  const safeBaseName = basename(originalFilename, extension).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const metadata = (await probeAudioMetadata(storedPath)) || EMPTY_METADATA;
  const extractedArtwork = metadata.hasEmbeddedArtwork
    ? await extractEmbeddedArtwork(storedPath, randomUUID())
    : null;

  const title = typeof fields.title === "string" ? fields.title.trim() : "";
  const artist = typeof fields.artist === "string" ? fields.artist.trim() : "";
  const uploadedBy = typeof fields.uploadedBy === "string" ? fields.uploadedBy.trim() : "";

  try {
    const song = await prisma.song.create({
      data: {
        title: title || metadata.title || safeBaseName || "Untitled",
        artist: artist || metadata.artist || null,
        album: metadata.album || null,
        genre: metadata.genre || null,
        year: metadata.year,
        uploadedBy: uploadedBy || null,
        filename: storedFilename,
        path: storedPath,
        mimeType,
        artworkFilename: extractedArtwork?.artworkFilename || null,
        artworkMimeType: extractedArtwork?.artworkMimeType || null,
        artworkPath: extractedArtwork?.artworkPath || null,
        duration: metadata.duration
      }
    });

    const responseSong = mapSong(song);
    runtime.realtime.io.emit("song:uploaded", responseSong);
    return responseSong;
  } catch (error) {
    await Promise.all([
      rm(storedPath, { force: true }).catch(() => {}),
      extractedArtwork?.artworkPath ? rm(extractedArtwork.artworkPath, { force: true }).catch(() => {}) : null
    ]);
    throw error;
  }
}

export async function deleteSong(songId, logger = runtime.logger) {
  const song = await getSongOrThrow(songId);

  const isPlaying = await prisma.queueItem.findFirst({
    where: { songId: song.id, status: "playing" },
    select: { id: true }
  });
  if (isPlaying) await runtime.player.skip();

  await prisma.$transaction([
    prisma.queueItem.deleteMany({ where: { songId: song.id } }),
    prisma.song.delete({ where: { id: song.id } })
  ]);
  await runtime.realtime.broadcastQueue();
  await runtime.realtime.broadcastMoods();

  for (const path of [song.path, song.artworkPath].filter(Boolean)) {
    try {
      await rm(path, { force: true });
    } catch (error) {
      logger.warn?.({ error, songId: song.id, path }, "Failed to remove file for deleted song");
    }
  }

  runtime.realtime.io.emit("songs:updated");
  return { ok: true };
}
