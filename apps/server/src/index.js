import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { createReadStream, existsSync, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, extname, basename, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { createPlayerService } from "./player.js";
import { createFolderImporter, findImportableFiles } from "./folder-importer.js";
import { createExternalMusicService } from "./external-music.js";

const prisma = new PrismaClient();
const ACTIVE_QUEUE_STATUSES = ["queued", "playing"];
const MAX_ACTIVE_QUEUE_ITEMS_PER_REQUESTER = 20;
const MAX_MOOD_SONGS = 10000;
const AUDIO_OUTPUT_SETTING_KEY = "player.audioOutputDeviceId";
const DEFAULT_AUDIO_OUTPUT_DEVICE_ID = "auto";
const defaultMaxUploadMb = 5 * 1024;
const configuredMaxUploadMb = Number(process.env.MAX_UPLOAD_MB || defaultMaxUploadMb);
const maxUploadMb = Number.isFinite(configuredMaxUploadMb) && configuredMaxUploadMb > 0 ? configuredMaxUploadMb : defaultMaxUploadMb;
const uploadMaxBytes = maxUploadMb * 1024 * 1024;
const configuredExternalImportMaxMb = Number(process.env.EXTERNAL_IMPORT_MAX_MB || 250);
const externalImportMaxBytes = Number.isFinite(configuredExternalImportMaxMb) && configuredExternalImportMaxMb > 0
  ? configuredExternalImportMaxMb * 1024 * 1024
  : 250 * 1024 * 1024;
const configuredExternalLibraryMaxMb = Number(process.env.EXTERNAL_LIBRARY_MAX_MB || 5120);
const externalLibraryMaxBytes = Number.isFinite(configuredExternalLibraryMaxMb) && configuredExternalLibraryMaxMb > 0
  ? configuredExternalLibraryMaxMb * 1024 * 1024
  : 5120 * 1024 * 1024;
const externalSearchWindows = new Map();
const externalImportWindows = new Map();
let externalImportInProgress = false;
const trustProxySetting = String(process.env.TRUST_PROXY || "").trim();
const IS_WIN = process.platform === "win32";
const allowedAudioExtensions = new Set(
  (process.env.ALLOWED_AUDIO_EXTENSIONS || ".mp3,.mp4,.wav,.m4a,.flac")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`))
);

function consumeRateLimit(windows, key, limit, windowMs) {
  const now = Date.now();
  if (windows.size > 10000) {
    for (const [windowKey, value] of windows) {
      if (value.resetAt <= now) windows.delete(windowKey);
    }
    if (windows.size > 10000) windows.delete(windows.keys().next().value);
  }
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function normalizeAudioOutputDeviceId(value) {
  if (typeof value !== "string") {
    return DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
  }

  const normalized = value.trim();
  return normalized || DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
}

async function getAudioOutputSetting() {
  const setting = await prisma.appSetting.findUnique({ where: { key: AUDIO_OUTPUT_SETTING_KEY } });
  return normalizeAudioOutputDeviceId(setting?.value);
}

async function setAudioOutputSetting(deviceId) {
  const normalized = normalizeAudioOutputDeviceId(deviceId);
  await prisma.appSetting.upsert({
    where: { key: AUDIO_OUTPUT_SETTING_KEY },
    update: { value: normalized },
    create: { key: AUDIO_OUTPUT_SETTING_KEY, value: normalized }
  });
  return normalized;
}

function resolveAudioProbeExec() {
  if (process.env.AUDIO_PROBE_EXEC) {
    return process.env.AUDIO_PROBE_EXEC;
  }

  if (IS_WIN) {
    const bundledFfprobe = join(process.cwd(), "../../ffmpeg-8.1.2/bin/ffprobe.exe");
    if (existsSync(bundledFfprobe)) {
      return bundledFfprobe;
    }
  }

  return "ffprobe";
}

function resolveAudioTranscodeExec() {
  if (process.env.AUDIO_TRANSCODE_EXEC) {
    return process.env.AUDIO_TRANSCODE_EXEC;
  }

  if (IS_WIN) {
    const bundledFfmpeg = join(process.cwd(), "../../ffmpeg-8.1.2/bin/ffmpeg.exe");
    if (existsSync(bundledFfmpeg)) {
      return bundledFfmpeg;
    }
  }

  return "ffmpeg";
}

const audioProbeExec = resolveAudioProbeExec();
const audioTranscodeExec = resolveAudioTranscodeExec();

const fastify = Fastify({
  logger: true,
  trustProxy: trustProxySetting === "true" ? true : trustProxySetting || false
});
await fastify.register(cors, { origin: true });
await fastify.register(multipart, {
  limits: {
    fileSize: uploadMaxBytes
  }
});

const io = new Server(fastify.server, {
  cors: { origin: true }
});

const uploadDirSetting = process.env.UPLOAD_DIR || "../../storage/uploads";
const uploadDir = isAbsolute(uploadDirSetting) ? uploadDirSetting : join(process.cwd(), uploadDirSetting);
await mkdir(uploadDir, { recursive: true });
const artworkDirSetting = process.env.ARTWORK_DIR || "../../storage/artwork";
const artworkDir = isAbsolute(artworkDirSetting) ? artworkDirSetting : join(process.cwd(), artworkDirSetting);
await mkdir(artworkDir, { recursive: true });
const importDirSetting = process.env.IMPORT_DIR || "../../storage/imports";
const importDir = isAbsolute(importDirSetting) ? importDirSetting : join(process.cwd(), importDirSetting);
await mkdir(importDir, { recursive: true });
const configuredImportPollMs = Number(process.env.IMPORT_POLL_MS || 5000);
const importPollMs = Number.isFinite(configuredImportPollMs) && configuredImportPollMs >= 100
  ? configuredImportPollMs
  : 5000;
const configuredImportSettleMs = Number(process.env.IMPORT_SETTLE_MS || 10000);
const importSettleMs = Number.isFinite(configuredImportSettleMs) && configuredImportSettleMs >= 0
  ? configuredImportSettleMs
  : 10000;

function buildArtworkUrl(song) {
  if (!song?.artworkFilename) {
    return null;
  }

  return `/api/songs/${encodeURIComponent(song.id)}/artwork`;
}

function mapSong(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    genre: song.genre,
    year: song.year,
    artworkUrl: buildArtworkUrl(song),
    mediaUrl: `/api/songs/${encodeURIComponent(song.id)}/media`,
    filename: song.filename,
    mimeType: song.mimeType,
    duration: song.duration,
    sourceProvider: song.sourceProvider,
    sourceUrl: song.sourceUrl,
    licenseUrl: song.licenseUrl,
    createdAt: song.createdAt
  };
}

function mapQueueItem(item) {
  return {
    id: item.id,
    status: item.status,
    requestedBy: item.requestedBy,
    song: item.song
      ? {
          id: item.song.id,
          title: item.song.title,
          artist: item.song.artist,
          album: item.song.album,
          genre: item.song.genre,
          year: item.song.year,
          artworkUrl: buildArtworkUrl(item.song),
          mediaUrl: `/api/songs/${encodeURIComponent(item.song.id)}/media`,
          mimeType: item.song.mimeType,
          duration: item.song.duration,
          sourceProvider: item.song.sourceProvider,
          sourceUrl: item.song.sourceUrl,
          licenseUrl: item.song.licenseUrl,
          createdAt: item.song.createdAt
        }
      : null
  };
}

function mapMood(mood) {
  return {
    id: mood.id,
    name: mood.name,
    songs: mood.songs.map((entry) => mapSong(entry.song)),
    createdAt: mood.createdAt,
    updatedAt: mood.updatedAt
  };
}

function normalizeMoodInput(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const songIds = Array.isArray(body?.songIds)
    ? body.songIds.map((songId) => (typeof songId === "string" ? songId.trim() : ""))
    : null;

  if (!name) return { error: "name is required" };
  if (name.length > 80) return { error: "name must be 80 characters or fewer" };
  if (!songIds) return { error: "songIds must be an array" };
  if (!songIds.length) return { error: "A mood must contain at least one song" };
  if (songIds.length > MAX_MOOD_SONGS) return { error: `A mood can contain up to ${MAX_MOOD_SONGS} songs` };
  if (songIds.some((songId) => !songId)) return { error: "Every songId must be a non-empty string" };
  if (new Set(songIds).size !== songIds.length) return { error: "A mood cannot contain the same song more than once" };

  return { name, songIds };
}

async function getMoods() {
  const moods = await prisma.mood.findMany({
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    include: {
      songs: {
        orderBy: { position: "asc" },
        include: { song: true }
      }
    }
  });

  return moods.map(mapMood);
}

async function emitMoodsUpdated() {
  io.emit("moods:updated", await getMoods());
}

function normalizeTags(tags) {
  const normalized = {};
  if (!tags || typeof tags !== "object") {
    return normalized;
  }

  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null) continue;
    const normalizedKey = String(key).trim().toLowerCase();
    const normalizedValue = String(value).trim();
    if (normalizedKey && normalizedValue) {
      normalized[normalizedKey] = normalizedValue;
    }
  }

  return normalized;
}

function parseYear(value) {
  if (!value) {
    return null;
  }

  const match = String(value).match(/(19|20)\d{2}/);
  if (!match) {
    return null;
  }

  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

async function probeAudioMetadata(filePath) {
  return new Promise((resolve) => {
    const probe = spawn(audioProbeExec, [
      "-v",
      "error",
      "-show_streams",
      "-show_entries",
      "format=format_name,duration:format_tags",
      "-of",
      "json",
      filePath
    ]);

    let stdout = "";
    let settled = false;
    const timeout = setTimeout(() => {
      probe.kill();
      finish(null);
    }, 30000);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    }

    probe.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    probe.once("error", () => {
      finish(null);
    });

    probe.once("close", (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const duration = Number(parsed?.format?.duration);
        const normalizedTags = normalizeTags(parsed?.format?.tags);
        const audioStream = Array.isArray(parsed?.streams)
          ? parsed.streams.find((stream) => stream?.codec_type === "audio")
          : null;
        const hasEmbeddedArtwork = Array.isArray(parsed?.streams)
          ? parsed.streams.some((stream) => stream?.codec_type === "video" && Number(stream?.disposition?.attached_pic) === 1)
          : false;
        const hasAudioStream = Boolean(audioStream);

        finish({
          duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
          title: normalizedTags.title || null,
          artist: normalizedTags.artist || normalizedTags.album_artist || null,
          album: normalizedTags.album || null,
          genre: normalizedTags.genre || null,
          year: parseYear(normalizedTags.date || normalizedTags.year || normalizedTags.originaldate),
          hasEmbeddedArtwork,
          hasAudioStream,
          audioCodec: typeof audioStream?.codec_name === "string" ? audioStream.codec_name : null,
          formatName: typeof parsed?.format?.format_name === "string" ? parsed.format.format_name : null
        });
      } catch {
        finish({
          duration: null,
          title: null,
          artist: null,
          album: null,
          genre: null,
          year: null,
          hasEmbeddedArtwork: false,
          hasAudioStream: false,
          audioCodec: null,
          formatName: null
        });
      }
    });
  });
}

const EMPTY_METADATA = Object.freeze({
  duration: null,
  title: null,
  artist: null,
  album: null,
  genre: null,
  year: null,
  hasEmbeddedArtwork: false,
  hasAudioStream: false,
  audioCodec: null,
  formatName: null
});

async function extractEmbeddedArtwork(inputPath, outputSeed) {
  const artworkFilename = `${outputSeed}.jpg`;
  const artworkPath = join(artworkDir, artworkFilename);

  return new Promise((resolve) => {
    const ffmpeg = spawn(audioTranscodeExec, [
      "-y",
      "-v",
      "error",
      "-i",
      inputPath,
      "-an",
      "-map",
      "0:v:0",
      "-vf",
      "scale=2000:2000:force_original_aspect_ratio=decrease",
      "-frames:v",
      "1",
      "-fs",
      "10485760",
      artworkPath
    ]);

    let settled = false;
    const timeout = setTimeout(() => {
      ffmpeg.kill();
      finish(null);
    }, 30000);
    async function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!result) await rm(artworkPath, { force: true }).catch(() => {});
      resolve(result);
    }

    ffmpeg.once("error", () => {
      finish(null);
    });

    ffmpeg.once("close", (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }

      finish({
        artworkFilename,
        artworkPath,
        artworkMimeType: "image/jpeg"
      });
    });
  });
}

function getImportedMimeType(extension) {
  return {
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".wav": "audio/wav"
  }[extension] || "application/octet-stream";
}

async function stageImportedSong(sourcePath, importId) {
  const extension = extname(sourcePath).toLowerCase();
  const sourceBaseName = basename(sourcePath, extension);
  const safeBaseName = sourceBaseName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "media";
  const songId = randomUUID();
  const storedFilename = `${importId}-${songId}-${safeBaseName}${extension}`;
  const storedPath = join(uploadDir, storedFilename);
  let extractedArtwork = null;

  try {
    await copyFile(sourcePath, storedPath);
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
        mimeType: getImportedMimeType(extension),
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
      extractedArtwork?.artworkPath ? rm(extractedArtwork.artworkPath, { force: true }).catch(() => {}) : Promise.resolve()
    ]);
    throw error;
  }
}

async function removeStagedFiles(songs) {
  await Promise.all(songs.flatMap((song) => [
    rm(song.path, { force: true }).catch(() => {}),
    song.artworkPath ? rm(song.artworkPath, { force: true }).catch(() => {}) : Promise.resolve()
  ]));
}

async function cleanupImportFiles(importId) {
  for (const directory of [uploadDir, artworkDir]) {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${importId}-`))
      .map((entry) => rm(join(directory, entry.name), { force: true }).catch(() => {})));
  }
}

async function importFolderAsMood({ importId, folderPath, moodName, files }) {
  if (files.length > MAX_MOOD_SONGS) {
    throw new Error(`Folder contains ${files.length} songs; the maximum is ${MAX_MOOD_SONGS}`);
  }

  fastify.log.info({ folderPath, moodName, songCount: files.length }, "Importing folder as mood");
  const songs = [];
  try {
    for (const file of files) {
      songs.push(await stageImportedSong(file.path, importId));
    }

    const currentFiles = await findImportableFiles(folderPath, allowedAudioExtensions);
    const folderChanged = currentFiles.length !== files.length || currentFiles.some((file, index) => {
      const original = files[index];
      return !original
        || file.relativePath !== original.relativePath
        || file.size !== original.size
        || file.modifiedAt !== original.modifiedAt;
    });
    if (folderChanged) {
      throw new Error("Folder changed during import; it will be retried when copying is complete");
    }

    await prisma.$transaction(async (tx) => {
      await tx.song.createMany({ data: songs.map((song) => song.data) });
      const existingMood = await tx.mood.findFirst({
        where: { name: moodName },
        orderBy: { createdAt: "asc" },
        select: { id: true }
      });

      if (existingMood) {
        await tx.moodSong.deleteMany({ where: { moodId: existingMood.id } });
        await tx.mood.update({
          where: { id: existingMood.id },
          data: { updatedAt: new Date() }
        });
        await tx.moodSong.createMany({
          data: songs.map((song, position) => ({ moodId: existingMood.id, songId: song.id, position }))
        });
      } else {
        const mood = await tx.mood.create({ data: { name: moodName } });
        await tx.moodSong.createMany({
          data: songs.map((song, position) => ({ moodId: mood.id, songId: song.id, position }))
        });
      }
      await tx.folderImport.update({
        where: { id: importId },
        data: { status: "completed" }
      });
    }, { timeout: 300000 });
  } catch (error) {
    await removeStagedFiles(songs);
    throw error;
  }

  try {
    io.emit("songs:updated");
    await emitMoodsUpdated();
  } catch (error) {
    fastify.log.error({ error, importId }, "Folder imported, but realtime notification failed");
  }
  fastify.log.info({ folderPath, moodName, songCount: songs.length }, "Folder import completed");
}

async function getActiveQueue() {
  const queue = await prisma.queueItem.findMany({
    where: { status: { in: ACTIVE_QUEUE_STATUSES } },
    orderBy: { createdAt: "asc" },
    include: { song: true }
  });

  return queue.map(mapQueueItem);
}

async function emitQueueUpdated() {
  io.emit("queue:updated", await getActiveQueue());
}

const player = createPlayerService({ prisma, io, emitQueueUpdated, deferStartup: true });
const externalMusic = createExternalMusicService({
  prisma,
  uploadDir,
  maxImportBytes: externalImportMaxBytes,
  maxLibraryBytes: externalLibraryMaxBytes,
  youtubeApiKey: String(process.env.YOUTUBE_API_KEY || "").trim(),
  probeAudioMetadata,
  extractEmbeddedArtwork
});

async function beginFolderImport({ importId, sourceName, workingName }) {
  await prisma.folderImport.create({
    data: { id: importId, sourceName, workingName }
  });
}

async function abortFolderImport(importId) {
  await cleanupImportFiles(importId);
  await prisma.folderImport.deleteMany({ where: { id: importId, status: "processing" } });
}

async function finishFolderImport(importId) {
  await prisma.folderImport.delete({ where: { id: importId } });
}

async function recoverFolderImports() {
  const imports = await prisma.folderImport.findMany({ orderBy: { createdAt: "asc" } });
  for (const folderImport of imports) {
    const sourcePath = join(importDir, folderImport.sourceName);
    const workingPath = join(importDir, folderImport.workingName);

    if (folderImport.status === "completed") {
      try {
        await rm(workingPath, { recursive: true, force: true });
        await prisma.folderImport.delete({ where: { id: folderImport.id } });
      } catch (error) {
        fastify.log.error({ error, workingPath }, "Completed folder import cleanup failed");
      }
      continue;
    }

    await cleanupImportFiles(folderImport.id);
    if (existsSync(workingPath)) {
      const recoveryPath = existsSync(sourcePath)
        ? join(importDir, `${folderImport.sourceName}-recovered-${folderImport.id.slice(0, 8)}`)
        : sourcePath;
      await rename(workingPath, recoveryPath);
    }
    await prisma.folderImport.delete({ where: { id: folderImport.id } });
  }
}

const folderImporter = createFolderImporter({
  importDir,
  allowedExtensions: allowedAudioExtensions,
  settleMs: importSettleMs,
  pollMs: importPollMs,
  recoverImports: recoverFolderImports,
  beginImport: beginFolderImport,
  abortImport: abortFolderImport,
  finishImport: finishFolderImport,
  importFolder: importFolderAsMood,
  logger: fastify.log
});

function requireAdmin(request, reply, done) {
  const adminPin = String(process.env.ADMIN_PIN || "").trim();
  const providedPin = request.headers["x-admin-pin"];

  if (!/^\d{4}$/.test(adminPin)) {
    reply.code(503).send({ error: "Admin PIN is not configured as four digits" });
    return;
  }

  if (providedPin !== adminPin) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }

  done();
}

fastify.setErrorHandler((error, request, reply) => {
  if (error?.code === "FST_REQ_FILE_TOO_LARGE") {
    return reply.code(413).send({ error: `Upload exceeds ${Math.floor(uploadMaxBytes / (1024 * 1024))}MB limit` });
  }

  request.log.error(error);
  return reply.code(error.statusCode || 500).send({ error: error.message || "Internal server error" });
});

fastify.get("/api/songs", async () => {
  const songs = await prisma.song.findMany({ orderBy: { createdAt: "desc" } });
  return songs.map(mapSong);
});

fastify.get("/api/external/search", async (request, reply) => {
  const provider = typeof request.query?.provider === "string" ? request.query.provider.trim().toLowerCase() : "";
  const query = typeof request.query?.q === "string" ? request.query.q.trim() : "";
  if (query.length < 2) return reply.code(400).send({ error: "Search query must contain at least 2 characters" });
  if (query.length > 100) return reply.code(400).send({ error: "Search query must be 100 characters or fewer" });
  if (!consumeRateLimit(externalSearchWindows, request.ip, 30, 60 * 1000)) {
    return reply.code(429).send({ error: "Too many external searches; try again shortly" });
  }

  return externalMusic.search(provider, query);
});

fastify.post("/api/external/import", async (request, reply) => {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    return reply.code(400).send({ error: "Request body must be a JSON object" });
  }

  const provider = typeof request.body.provider === "string" ? request.body.provider.trim().toLowerCase() : "";
  const sourceId = typeof request.body.sourceId === "string" ? request.body.sourceId.trim() : "";
  const sourceFile = typeof request.body.sourceFile === "string" ? request.body.sourceFile.trim() : "";
  if (!provider) return reply.code(400).send({ error: "provider is required" });
  if (!sourceId) return reply.code(400).send({ error: "sourceId is required" });
  if (!sourceFile) return reply.code(400).send({ error: "sourceFile is required" });
  if (!consumeRateLimit(externalImportWindows, request.ip, 3, 60 * 60 * 1000)) {
    return reply.code(429).send({ error: "External import limit reached; try again later" });
  }
  if (externalImportInProgress) {
    return reply.code(429).send({ error: "Another external song is being imported; try again shortly" });
  }

  externalImportInProgress = true;
  try {
    const result = await externalMusic.importTrack(provider, sourceId, sourceFile);
    const responseSong = mapSong(result.song);
    if (!result.alreadyImported) io.emit("song:uploaded", responseSong);
    return reply.code(result.alreadyImported ? 200 : 201).send({
      song: responseSong,
      alreadyImported: result.alreadyImported
    });
  } finally {
    externalImportInProgress = false;
  }
});

fastify.get("/api/moods", async () => {
  return getMoods();
});

fastify.post("/api/moods", { preHandler: requireAdmin }, async (request, reply) => {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    return reply.code(400).send({ error: "Request body must be a JSON object" });
  }

  const input = normalizeMoodInput(request.body);
  if (input.error) return reply.code(400).send({ error: input.error });

  const songs = await prisma.song.findMany({
    where: { id: { in: input.songIds } },
    select: { id: true }
  });
  if (songs.length !== input.songIds.length) {
    return reply.code(400).send({ error: "One or more songs do not exist" });
  }

  const mood = await prisma.mood.create({
    data: {
      name: input.name,
      songs: {
        create: input.songIds.map((songId, position) => ({ songId, position }))
      }
    },
    include: {
      songs: {
        orderBy: { position: "asc" },
        include: { song: true }
      }
    }
  });

  await emitMoodsUpdated();
  return reply.code(201).send(mapMood(mood));
});

fastify.put("/api/moods/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const moodId = typeof request.params?.id === "string" ? request.params.id.trim() : "";
  if (!moodId) return reply.code(400).send({ error: "mood id is required" });
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    return reply.code(400).send({ error: "Request body must be a JSON object" });
  }

  const input = normalizeMoodInput(request.body);
  if (input.error) return reply.code(400).send({ error: input.error });

  const [existingMood, songs] = await Promise.all([
    prisma.mood.findUnique({ where: { id: moodId }, select: { id: true } }),
    prisma.song.findMany({ where: { id: { in: input.songIds } }, select: { id: true } })
  ]);
  if (!existingMood) return reply.code(404).send({ error: "Mood not found" });
  if (songs.length !== input.songIds.length) {
    return reply.code(400).send({ error: "One or more songs do not exist" });
  }

  const mood = await prisma.$transaction(async (tx) => {
    await tx.moodSong.deleteMany({ where: { moodId } });
    return tx.mood.update({
      where: { id: moodId },
      data: {
        name: input.name,
        songs: {
          create: input.songIds.map((songId, position) => ({ songId, position }))
        }
      },
      include: {
        songs: {
          orderBy: { position: "asc" },
          include: { song: true }
        }
      }
    });
  });

  await emitMoodsUpdated();
  return mapMood(mood);
});

fastify.delete("/api/moods/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const moodId = typeof request.params?.id === "string" ? request.params.id.trim() : "";
  if (!moodId) return reply.code(400).send({ error: "mood id is required" });

  const result = await prisma.mood.deleteMany({ where: { id: moodId } });
  if (!result.count) return reply.code(404).send({ error: "Mood not found" });

  await emitMoodsUpdated();
  return { ok: true };
});

fastify.post("/api/moods/:id/select", async (request, reply) => {
  const moodId = typeof request.params?.id === "string" ? request.params.id.trim() : "";
  if (!moodId) return reply.code(400).send({ error: "mood id is required" });

  const requestedBy = typeof request.body?.requestedBy === "string" ? request.body.requestedBy.trim() : "";
  if (requestedBy.length > 40) return reply.code(400).send({ error: "requestedBy must be 40 characters or fewer" });

  const requesterKey = requestedBy || `ip:${request.ip}`;
  const result = await prisma.$transaction(async (tx) => {
    const mood = await tx.mood.findUnique({
      where: { id: moodId },
      include: { songs: { orderBy: { position: "asc" }, select: { songId: true } } }
    });
    if (!mood) return { error: "not-found" };
    if (!mood.songs.length) return { error: "empty" };

    const cleared = await tx.queueItem.updateMany({
      where: { status: "queued" },
      data: { status: "replaced" }
    });
    const queuedAt = Date.now();
    for (const [position, entry] of mood.songs.entries()) {
      await tx.queueItem.create({
        data: {
          songId: entry.songId,
          requestedBy: requestedBy || null,
          requesterKey,
          createdAt: new Date(queuedAt + position)
        }
      });
    }

    return { name: mood.name, queuedCount: mood.songs.length, replacedCount: cleared.count };
  });

  if (result.error === "not-found") return reply.code(404).send({ error: "Mood not found" });
  if (result.error === "empty") return reply.code(409).send({ error: "This mood has no available songs" });

  await emitQueueUpdated();
  await player.ensurePlaying();
  return { ok: true, ...result };
});

fastify.get("/api/songs/:id/artwork", async (request, reply) => {
  const songId = typeof request.params?.id === "string" ? request.params.id.trim() : "";
  if (!songId) {
    return reply.code(400).send({ error: "songId is required" });
  }

  const song = await prisma.song.findUnique({
    where: { id: songId },
    select: { artworkPath: true, artworkMimeType: true }
  });

  if (!song?.artworkPath) {
    return reply.code(404).send({ error: "Artwork not found" });
  }

  try {
    const artworkBuffer = await readFile(song.artworkPath);
    return reply.type(song.artworkMimeType || "image/jpeg").send(artworkBuffer);
  } catch {
    return reply.code(404).send({ error: "Artwork not found" });
  }
});

fastify.get("/api/songs/:id/media", async (request, reply) => {
  const songId = typeof request.params?.id === "string" ? request.params.id.trim() : "";
  if (!songId) return reply.code(400).send({ error: "songId is required" });

  const song = await prisma.song.findUnique({
    where: { id: songId },
    select: { path: true, mimeType: true }
  });
  if (!song?.path) return reply.code(404).send({ error: "Media not found" });

  try {
    const fileStat = await stat(song.path);
    const range = request.headers.range;
    reply.header("Accept-Ranges", "bytes").type(song.mimeType || "application/octet-stream");

    if (!range) {
      reply.header("Content-Length", fileStat.size);
      return reply.send(createReadStream(song.path));
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return reply.code(416).header("Content-Range", `bytes */${fileStat.size}`).send();
    }

    let start = match[1] ? Number(match[1]) : null;
    let end = match[2] ? Number(match[2]) : null;
    if (start === null) {
      const suffixLength = end;
      if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
        return reply.code(416).header("Content-Range", `bytes */${fileStat.size}`).send();
      }
      start = Math.max(0, fileStat.size - suffixLength);
      end = fileStat.size - 1;
    } else {
      end = end === null ? fileStat.size - 1 : Math.min(end, fileStat.size - 1);
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= fileStat.size || end < start) {
      return reply.code(416).header("Content-Range", `bytes */${fileStat.size}`).send();
    }

    reply
      .code(206)
      .header("Content-Range", `bytes ${start}-${end}/${fileStat.size}`)
      .header("Content-Length", end - start + 1);
    return reply.send(createReadStream(song.path, { start, end }));
  } catch {
    return reply.code(404).send({ error: "Media not found" });
  }
});

fastify.delete("/api/songs/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const songId = typeof request.params?.id === "string" ? request.params.id.trim() : "";

  if (!songId) {
    return reply.code(400).send({ error: "songId is required" });
  }

  const song = await prisma.song.findUnique({ where: { id: songId } });
  if (!song) {
    return reply.code(404).send({ error: "Song not found" });
  }

  const activePlaybackReference = await prisma.queueItem.findFirst({
    where: {
      songId,
      status: "playing"
    },
    select: { id: true }
  });

  if (activePlaybackReference) {
    await player.skip();
  }

  await prisma.$transaction([
    prisma.queueItem.deleteMany({ where: { songId } }),
    prisma.song.delete({ where: { id: songId } })
  ]);
  await emitQueueUpdated();

  try {
    await rm(song.path, { force: true });
  } catch (error) {
    request.log.warn({ error, songId }, "Failed to remove uploaded file for deleted song");
  }

  if (song.artworkPath) {
    try {
      await rm(song.artworkPath, { force: true });
    } catch (error) {
      request.log.warn({ error, songId }, "Failed to remove artwork file for deleted song");
    }
  }

  return { ok: true };
});

fastify.post("/api/songs/upload", async (request, reply) => {
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
      if (part.type === "file") {
        fileCount += 1;
        if (fileCount > 1) {
          part.file.resume();
          continue;
        }

        originalFilename = part.filename;
        mimeType = part.mimetype;
        const extension = extname(originalFilename).toLowerCase();
        if (!allowedAudioExtensions.has(extension)) {
          part.file.resume();
          return reply.code(400).send({ error: "Unsupported media file type" });
        }

        const safeBaseName = basename(originalFilename, extension).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "media";
        storedFilename = `${randomUUID()}-${safeBaseName}${extension}`;
        storedPath = join(uploadDir, storedFilename);
        await pipeline(part.file, createWriteStream(storedPath));
        truncated = part.file.truncated;
      } else {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    if (storedPath) await rm(storedPath, { force: true }).catch(() => {});
    throw error;
  }

  if (truncated) {
    await rm(storedPath, { force: true });
    return reply.code(413).send({ error: `Upload exceeds ${Math.floor(uploadMaxBytes / (1024 * 1024))}MB limit` });
  }

  if (fileCount !== 1 || !storedPath || !originalFilename) {
    if (storedPath) {
      await rm(storedPath, { force: true });
    }
    return reply.code(400).send({ error: fileCount > 1 ? "Exactly one media file is required" : "Media file is required" });
  }

  const extension = extname(originalFilename).toLowerCase();

  const safeBaseName = basename(originalFilename, extension).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const metadata = (await probeAudioMetadata(storedPath)) || EMPTY_METADATA;
  const extractedArtwork = metadata.hasEmbeddedArtwork ? await extractEmbeddedArtwork(storedPath, randomUUID()) : null;
  const normalizedTitle = typeof fields.title === "string" ? fields.title.trim() : "";
  const normalizedArtist = typeof fields.artist === "string" ? fields.artist.trim() : "";
  const normalizedUploadedBy = typeof fields.uploadedBy === "string" ? fields.uploadedBy.trim() : "";

  let song;
  try {
    song = await prisma.song.create({
      data: {
      title: normalizedTitle || metadata.title || safeBaseName,
      artist: normalizedArtist || metadata.artist || null,
      album: metadata.album || null,
      genre: metadata.genre || null,
      year: metadata.year,
      uploadedBy: normalizedUploadedBy || null,
      filename: storedFilename,
      path: storedPath,
      mimeType,
      artworkFilename: extractedArtwork?.artworkFilename || null,
      artworkMimeType: extractedArtwork?.artworkMimeType || null,
      artworkPath: extractedArtwork?.artworkPath || null,
      duration: metadata.duration
      }
    });
  } catch (error) {
    await Promise.all([
      rm(storedPath, { force: true }).catch(() => {}),
      extractedArtwork?.artworkPath ? rm(extractedArtwork.artworkPath, { force: true }).catch(() => {}) : Promise.resolve()
    ]);
    throw error;
  }

  const responseSong = mapSong(song);
  io.emit("song:uploaded", responseSong);
  return reply.code(201).send(responseSong);
});

fastify.get("/api/queue", async () => {
  return getActiveQueue();
});

fastify.post("/api/queue", async (request, reply) => {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    return reply.code(400).send({ error: "Request body must be a JSON object" });
  }

  const { songId, requestedBy, playNext = false } = request.body || {};
  const normalizedSongId = typeof songId === "string" ? songId.trim() : "";
  const normalizedRequestedBy = typeof requestedBy === "string" ? requestedBy.trim() : "";

  if (!normalizedSongId) {
    return reply.code(400).send({ error: "songId is required" });
  }

  if (typeof playNext !== "boolean") {
    return reply.code(400).send({ error: "playNext must be a boolean" });
  }

  const song = await prisma.song.findUnique({ where: { id: normalizedSongId }, select: { id: true } });
  if (!song) {
    return reply.code(404).send({ error: "Song not found" });
  }

  const requesterKey = normalizedRequestedBy || `ip:${request.ip}`;
  const activeRequestCount = await prisma.queueItem.count({
    where: {
      requesterKey,
      status: { in: ACTIVE_QUEUE_STATUSES }
    }
  });

  if (activeRequestCount >= MAX_ACTIVE_QUEUE_ITEMS_PER_REQUESTER) {
    return reply
      .code(409)
      .send({ error: `You can only have up to ${MAX_ACTIVE_QUEUE_ITEMS_PER_REQUESTER} active songs in the queue` });
  }

  let createdAt;
  if (playNext) {
    const firstQueued = await prisma.queueItem.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true }
    });
    if (firstQueued) createdAt = new Date(firstQueued.createdAt.getTime() - 1);
  }

  const item = await prisma.queueItem.create({
    data: {
      songId: normalizedSongId,
      requestedBy: normalizedRequestedBy || null,
      requesterKey,
      ...(createdAt ? { createdAt } : {})
    }
  });

  await emitQueueUpdated();
  await player.ensurePlaying();

  return { id: item.id, status: item.status };
});

fastify.delete("/api/queue/:id", async (request, reply) => {
  const queueItemId = typeof request.params?.id === "string" ? request.params.id.trim() : "";
  if (!queueItemId) return reply.code(400).send({ error: "queue item id is required" });

  const item = await prisma.queueItem.findUnique({ where: { id: queueItemId }, select: { status: true } });
  if (!item) return reply.code(404).send({ error: "Queue item not found" });
  if (item.status !== "queued") return reply.code(409).send({ error: "Only queued items can be removed" });

  await prisma.queueItem.update({ where: { id: queueItemId }, data: { status: "removed" } });
  await emitQueueUpdated();
  return { ok: true };
});

fastify.delete("/api/queue", { preHandler: requireAdmin }, async () => {
  const result = await prisma.queueItem.updateMany({
    where: { status: "queued" },
    data: { status: "cleared" }
  });

  await emitQueueUpdated();
  return { ok: true, clearedCount: result.count };
});

fastify.get("/api/player", async () => {
  return player.getState();
});

fastify.post("/api/player/skip", async () => {
  await player.skip();
  return { ok: true };
});

fastify.post("/api/player/pause", async () => {
  await player.pause();
  return { ok: true };
});

fastify.post("/api/player/resume", async () => {
  await player.resume();
  return { ok: true };
});

fastify.post("/api/player/stop", { preHandler: requireAdmin }, async () => {
  await player.stop();
  return { ok: true };
});

fastify.post("/api/player/start", { preHandler: requireAdmin }, async () => {
  await player.start();
  return { ok: true };
});

fastify.post("/api/player/loop", async (request, reply) => {
  const { enabled } = request.body || {};
  if (typeof enabled !== "boolean") {
    return reply.code(400).send({ error: "enabled must be a boolean" });
  }

  await player.setLoopQueue(enabled);
  return { ok: true, loopQueue: enabled };
});

fastify.post("/api/player/seek", async (request, reply) => {
  const { positionSeconds } = request.body || {};
  const normalizedPosition = Number(positionSeconds);
  if (!Number.isFinite(normalizedPosition) || normalizedPosition < 0) {
    return reply.code(400).send({ error: "positionSeconds must be a non-negative number" });
  }

  await player.seek(normalizedPosition);
  return { ok: true };
});

fastify.post("/api/player/volume", { preHandler: requireAdmin }, async (request, reply) => {
  const { volume } = request.body || {};
  const normalizedVolume = Number(volume);
  if (!Number.isFinite(normalizedVolume)) {
    return reply.code(400).send({ error: "volume must be a number" });
  }

  if (normalizedVolume < 0 || normalizedVolume > 100) {
    return reply.code(400).send({ error: "volume must be between 0 and 100" });
  }

  await player.setVolume(normalizedVolume);
  return { ok: true };
});

fastify.get("/api/admin/settings/audio-output", { preHandler: requireAdmin }, async () => {
  const deviceId = await getAudioOutputSetting();
  const playerPreference = player.getAudioOutputPreference();
  return {
    deviceId,
    applied: playerPreference.applied,
    message: playerPreference.message,
    lastAttemptAt: playerPreference.lastAttemptAt
  };
});

fastify.post("/api/admin/settings/audio-output", { preHandler: requireAdmin }, async (request, reply) => {
  const { deviceId } = request.body || {};
  if (deviceId !== undefined && typeof deviceId !== "string") {
    return reply.code(400).send({ error: "deviceId must be a string when provided" });
  }

  const normalizedDeviceId = await setAudioOutputSetting(deviceId);
  const applyResult = await player.setPreferredAudioOutputDevice(normalizedDeviceId);

  return {
    ok: true,
    deviceId: normalizedDeviceId,
    applied: applyResult.applied,
    message: applyResult.message,
    lastAttemptAt: applyResult.lastAttemptAt
  };
});

io.on("connection", async (socket) => {
  socket.emit("player:state", player.getState());
  socket.emit("queue:updated", await getActiveQueue());
  socket.emit("moods:updated", await getMoods());

  socket.on("queue:refresh", async () => {
    socket.emit("queue:updated", await getActiveQueue());
  });

  socket.on("player:refresh", () => {
    socket.emit("player:state", player.getState());
  });

  socket.on("moods:refresh", async () => {
    socket.emit("moods:updated", await getMoods());
  });
});

const port = Number(process.env.PORT || 3000);
fastify.log.info({ audioProbeExec }, "Audio probe executable resolved");
fastify.log.info({ audioTranscodeExec }, "Audio transcode executable resolved");
let shutdownPromise = null;
let isShuttingDown = false;
function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  isShuttingDown = true;
  shutdownPromise = (async () => {
    fastify.log.info(`Received ${signal}, shutting down`);
    const playerShutdownPromise = player.shutdown();
    await folderImporter.stop();
    await playerShutdownPromise;
    await fastify.close();
    await prisma.$disconnect();
    process.exit(0);
  })().catch((error) => {
    fastify.log.error(error, "Server shutdown failed");
    process.exit(1);
  });
  return shutdownPromise;
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

try {
  await fastify.listen({ port, host: "0.0.0.0" });
  fastify.log.info(`Office Jukebox server listening on ${port}`);
  if (!isShuttingDown) await player.cleanupOrphanedPlayback();
  if (!isShuttingDown) {
    const persistedAudioOutputDeviceId = await getAudioOutputSetting();
    await player.setPreferredAudioOutputDevice(persistedAudioOutputDeviceId);
    await prisma.queueItem.updateMany({ where: { status: "playing" }, data: { status: "queued" } });
  }
  if (!isShuttingDown) await recoverFolderImports();
  if (!isShuttingDown) await player.activate();
  if (!isShuttingDown) {
    await folderImporter.start();
    fastify.log.info({ importDir, importPollMs, importSettleMs }, "Folder import inbox started");
  }
} catch (error) {
  if (!isShuttingDown) {
    isShuttingDown = true;
    await folderImporter.stop();
    await player.shutdown();
    await fastify.close();
    await prisma.$disconnect();
  }
  throw error;
}
