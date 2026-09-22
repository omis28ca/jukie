import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { config } from "../config.js";
import { requireAdmin } from "../lib/identity.js";
import { deleteSong, getSongOrThrow, listGenres, listSongs, storeUpload } from "../services/library.js";

export async function songRoutes(fastify) {
  fastify.get("/api/songs", async (request) => {
    const songs = await listSongs({ search: request.query?.search, genre: request.query?.genre });
    return { songs };
  });

  fastify.get("/api/songs/genres", async () => {
    return { genres: await listGenres() };
  });

  fastify.post("/api/songs/upload", async (request, reply) => {
    const song = await storeUpload(request);
    return reply.code(201).send({ song });
  });

  fastify.get("/api/songs/:id/artwork", async (request, reply) => {
    const song = await getSongOrThrow(request.params?.id, { artworkPath: true, artworkMimeType: true });
    if (!song.artworkPath) return reply.code(404).send({ error: "Artwork not found" });

    try {
      const artwork = await readFile(song.artworkPath);
      return reply.type(song.artworkMimeType || "image/jpeg").header("Cache-Control", "public, max-age=86400").send(artwork);
    } catch {
      return reply.code(404).send({ error: "Artwork not found" });
    }
  });

  fastify.get("/api/songs/:id/media", async (request, reply) => {
    const song = await getSongOrThrow(request.params?.id, { path: true, mimeType: true });
    if (!song.path) return reply.code(404).send({ error: "Media not found" });

    let fileStat;
    try {
      fileStat = await stat(song.path);
    } catch {
      return reply.code(404).send({ error: "Media not found" });
    }

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
  });

  fastify.delete("/api/songs/:id", { preHandler: requireAdmin }, async (request) => {
    return deleteSong(request.params?.id, request.log);
  });

  fastify.get("/api/config", async () => {
    return {
      maxUploadMb: config.maxUploadMb,
      allowedExtensions: [...config.allowedAudioExtensions],
      maxActiveQueueItemsPerRequester: config.maxActiveQueueItemsPerRequester,
      externalSearchEnabled: true,
      youtubeSearchEnabled: Boolean(config.youtubeApiKey),
      mqttEnabled: Boolean(config.mqtt.url)
    };
  });
}
