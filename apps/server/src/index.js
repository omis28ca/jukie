import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname, basename, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { createPlayerService } from "./player.js";

const prisma = new PrismaClient();
const ACTIVE_QUEUE_STATUSES = ["queued", "playing"];
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 100);
const uploadMaxBytes = Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb * 1024 * 1024 : 100 * 1024 * 1024;
const allowedAudioExtensions = new Set(
  (process.env.ALLOWED_AUDIO_EXTENSIONS || ".mp3,.wav,.m4a,.flac")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`))
);

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

function mapSong(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
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
          duration: item.song.duration,
          createdAt: item.song.createdAt
        }
      : null
  };
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

fastify.post("/api/songs/upload", async (request, reply) => {
  const parts = request.parts();

  let fileBuffer = null;
  let originalFilename = null;
  let mimeType = null;
  const fields = {};

  for await (const part of parts) {
    if (part.type === "file") {
      originalFilename = part.filename;
      mimeType = part.mimetype;
      fileBuffer = await part.toBuffer();
    } else {
      fields[part.fieldname] = part.value;
    }
  }

  if (!fileBuffer || !originalFilename) {
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

  const song = await prisma.song.create({
    data: {
      title: fields.title || safeBaseName,
      artist: fields.artist || null,
      uploadedBy: fields.uploadedBy || null,
      filename: storedFilename,
      path: storedPath,
      mimeType
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
  const existingActiveRequest = await prisma.queueItem.findFirst({
    where: {
      requesterKey,
      status: { in: ACTIVE_QUEUE_STATUSES }
    },
    select: { id: true }
  });

  if (existingActiveRequest) {
    return reply.code(409).send({ error: "You already have a song in the active queue" });
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

fastify.post("/api/player/volume", { preHandler: requireAdmin }, async (request, reply) => {
  const { volume } = request.body || {};
  const normalizedVolume = Number(volume);
  if (!Number.isFinite(normalizedVolume)) {
    return reply.code(400).send({ error: "volume must be a number" });
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
await player.ensurePlaying();

await fastify.listen({ port, host: "0.0.0.0" });
fastify.log.info(`Office Jukebox server listening on ${port}`);

async function shutdown(signal) {
  fastify.log.info(`Received ${signal}, shutting down`);
  await player.stop();
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

