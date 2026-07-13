import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, extname, basename, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { createPlayerService } from "./player.js";

const prisma = new PrismaClient();
const ACTIVE_QUEUE_STATUSES = ["queued", "playing"];
const MAX_ACTIVE_QUEUE_ITEMS_PER_REQUESTER = 20;
const defaultMaxUploadMb = 5 * 1024;
const configuredMaxUploadMb = Number(process.env.MAX_UPLOAD_MB || defaultMaxUploadMb);
const maxUploadMb = Number.isFinite(configuredMaxUploadMb) && configuredMaxUploadMb > 0 ? configuredMaxUploadMb : defaultMaxUploadMb;
const uploadMaxBytes = maxUploadMb * 1024 * 1024;
const IS_WIN = process.platform === "win32";
const allowedAudioExtensions = new Set(
  (process.env.ALLOWED_AUDIO_EXTENSIONS || ".mp3,.wav,.m4a,.flac")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`))
);

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

const fastify = Fastify({ logger: true });
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
    filename: song.filename,
    duration: song.duration,
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
          duration: item.song.duration,
          createdAt: item.song.createdAt
        }
      : null
  };
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
      "format=duration:format_tags",
      "-of",
      "json",
      filePath
    ]);

    let stdout = "";
    probe.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    probe.once("error", () => {
      resolve(null);
    });

    probe.once("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const duration = Number(parsed?.format?.duration);
        const normalizedTags = normalizeTags(parsed?.format?.tags);
        const hasEmbeddedArtwork = Array.isArray(parsed?.streams)
          ? parsed.streams.some((stream) => stream?.codec_type === "video" && Number(stream?.disposition?.attached_pic) === 1)
          : false;

        resolve({
          duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
          title: normalizedTags.title || null,
          artist: normalizedTags.artist || normalizedTags.album_artist || null,
          album: normalizedTags.album || null,
          genre: normalizedTags.genre || null,
          year: parseYear(normalizedTags.date || normalizedTags.year || normalizedTags.originaldate),
          hasEmbeddedArtwork
        });
      } catch {
        resolve({
          duration: null,
          title: null,
          artist: null,
          album: null,
          genre: null,
          year: null,
          hasEmbeddedArtwork: false
        });
      }
    });
  });
}

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
      "-frames:v",
      "1",
      artworkPath
    ]);

    ffmpeg.once("error", () => {
      resolve(null);
    });

    ffmpeg.once("close", async (code) => {
      if (code !== 0) {
        try {
          await rm(artworkPath, { force: true });
        } catch {
          // Ignore cleanup failures for optional extracted artwork files.
        }
        resolve(null);
        return;
      }

      resolve({
        artworkFilename,
        artworkPath,
        artworkMimeType: "image/jpeg"
      });
    });
  });
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

const player = createPlayerService({ prisma, io, emitQueueUpdated });

function requireAdmin(request, reply, done) {
  const adminPin = process.env.ADMIN_PIN;
  const providedPin = request.headers["x-admin-pin"];

  if (adminPin && providedPin !== adminPin) {
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

  let fileBuffer = null;
  let originalFilename = null;
  let mimeType = null;
  let fileCount = 0;
  const fields = {};

  for await (const part of parts) {
    if (part.type === "file") {
      fileCount += 1;
      originalFilename = part.filename;
      mimeType = part.mimetype;
      fileBuffer = await part.toBuffer();
    } else {
      fields[part.fieldname] = part.value;
    }
  }

  if (fileCount !== 1 || !fileBuffer || !originalFilename) {
    return reply.code(400).send({ error: "Audio file is required" });
  }

  const extension = extname(originalFilename).toLowerCase();

  if (!allowedAudioExtensions.has(extension)) {
    return reply.code(400).send({ error: "Unsupported audio file type" });
  }

  const safeBaseName = basename(originalFilename, extension).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const storedFilename = `${randomUUID()}-${safeBaseName}${extension}`;
  const storedPath = join(uploadDir, storedFilename);

  await writeFile(storedPath, fileBuffer);
  const metadata = await probeAudioMetadata(storedPath);
  const extractedArtwork = metadata.hasEmbeddedArtwork ? await extractEmbeddedArtwork(storedPath, randomUUID()) : null;
  const normalizedTitle = typeof fields.title === "string" ? fields.title.trim() : "";
  const normalizedArtist = typeof fields.artist === "string" ? fields.artist.trim() : "";
  const normalizedUploadedBy = typeof fields.uploadedBy === "string" ? fields.uploadedBy.trim() : "";

  const song = await prisma.song.create({
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

  const { songId, requestedBy } = request.body || {};
  const normalizedSongId = typeof songId === "string" ? songId.trim() : "";
  const normalizedRequestedBy = typeof requestedBy === "string" ? requestedBy.trim() : "";

  if (!normalizedSongId) {
    return reply.code(400).send({ error: "songId is required" });
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

  const item = await prisma.queueItem.create({
    data: {
      songId: normalizedSongId,
      requestedBy: normalizedRequestedBy || null,
      requesterKey
    }
  });

  await emitQueueUpdated();
  await player.ensurePlaying();

  return { id: item.id, status: item.status };
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

fastify.post("/api/player/skip", { preHandler: requireAdmin }, async () => {
  await player.skip();
  return { ok: true };
});

fastify.post("/api/player/pause", { preHandler: requireAdmin }, async () => {
  await player.pause();
  return { ok: true };
});

fastify.post("/api/player/resume", { preHandler: requireAdmin }, async () => {
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

fastify.post("/api/player/loop", { preHandler: requireAdmin }, async (request, reply) => {
  const { enabled } = request.body || {};
  if (typeof enabled !== "boolean") {
    return reply.code(400).send({ error: "enabled must be a boolean" });
  }

  await player.setLoopQueue(enabled);
  return { ok: true, loopQueue: enabled };
});

fastify.post("/api/player/seek", { preHandler: requireAdmin }, async (request, reply) => {
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

io.on("connection", async (socket) => {
  socket.emit("player:state", player.getState());
  socket.emit("queue:updated", await getActiveQueue());

  socket.on("queue:refresh", async () => {
    socket.emit("queue:updated", await getActiveQueue());
  });

  socket.on("player:refresh", () => {
    socket.emit("player:state", player.getState());
  });
});

const port = Number(process.env.PORT || 3000);
fastify.log.info({ audioProbeExec }, "Audio probe executable resolved");
fastify.log.info({ audioTranscodeExec }, "Audio transcode executable resolved");
await player.ensurePlaying();

await fastify.listen({ port, host: "0.0.0.0" });
fastify.log.info(`Office Jukebox server listening on ${port}`);

async function shutdown(signal) {
  fastify.log.info(`Received ${signal}, shutting down`);
  await player.shutdown();
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
