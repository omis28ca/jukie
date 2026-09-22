import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { httpError, requireObjectBody } from "../lib/http.js";
import { requireAdmin } from "../lib/identity.js";
import { runtime } from "../runtime.js";
import { listAudioOutputDevices } from "../services/audio-devices.js";
import { getAudioOutputSetting, setAudioOutputSetting } from "../services/settings.js";
import { describeStorage, setStorageRoot } from "../services/storage.js";

async function directoryReport(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile());
  const sizes = await Promise.all(
    files.map((entry) =>
      stat(join(directory, entry.name))
        .then((details) => details.size)
        .catch(() => 0)
    )
  );

  return {
    directory,
    fileCount: files.length,
    totalBytes: sizes.reduce((total, size) => total + size, 0),
    names: files.map((entry) => entry.name)
  };
}

export async function adminRoutes(fastify) {
  fastify.post("/api/admin/auth", async (request) => {
    requireObjectBody(request.body);

    const pin = String(request.body.pin ?? "").trim();
    if (!/^\d{4}$/.test(config.adminPin)) {
      throw httpError(503, "Admin PIN is not configured as four digits");
    }
    if (pin !== config.adminPin) throw httpError(401, "Incorrect PIN");

    return { ok: true };
  });

  fastify.get("/api/admin/settings/audio-output", { preHandler: requireAdmin }, async () => {
    const [deviceId, devices] = await Promise.all([getAudioOutputSetting(), listAudioOutputDevices()]);
    const preference = runtime.player.getAudioOutputPreference();

    return {
      deviceId,
      devices,
      applied: preference.applied,
      message: preference.message,
      lastAttemptAt: preference.lastAttemptAt
    };
  });

  fastify.post("/api/admin/settings/audio-output", { preHandler: requireAdmin }, async (request) => {
    requireObjectBody(request.body);

    const { deviceId } = request.body;
    if (deviceId !== undefined && typeof deviceId !== "string") {
      throw httpError(400, "deviceId must be a string when provided");
    }

    const normalizedDeviceId = await setAudioOutputSetting(deviceId);
    const applyResult = await runtime.player.setPreferredAudioOutputDevice(normalizedDeviceId);

    return {
      ok: true,
      deviceId: normalizedDeviceId,
      devices: await listAudioOutputDevices(),
      applied: applyResult.applied,
      message: applyResult.message,
      lastAttemptAt: applyResult.lastAttemptAt
    };
  });

  fastify.get("/api/admin/storage", { preHandler: requireAdmin }, async () => {
    const [uploads, artwork, songCount] = await Promise.all([
      directoryReport(config.uploadDir),
      directoryReport(config.artworkDir),
      prisma.song.count()
    ]);

    const referenced = await prisma.song.findMany({ select: { filename: true, artworkFilename: true } });
    const referencedUploads = new Set(referenced.map((song) => song.filename).filter(Boolean));
    const referencedArtwork = new Set(referenced.map((song) => song.artworkFilename).filter(Boolean));

    return {
      songCount,
      uploads: {
        directory: uploads.directory,
        fileCount: uploads.fileCount,
        totalBytes: uploads.totalBytes,
        orphanCount: uploads.names.filter((name) => !referencedUploads.has(name)).length
      },
      artwork: {
        directory: artwork.directory,
        fileCount: artwork.fileCount,
        totalBytes: artwork.totalBytes,
        orphanCount: artwork.names.filter((name) => !referencedArtwork.has(name)).length
      },
      importDirectory: config.importDir
    };
  });

  fastify.get("/api/admin/storage/location", { preHandler: requireAdmin }, async () => {
    return describeStorage();
  });

  /** Points the music library at another drive or folder, optionally moving what is already there. */
  fastify.post("/api/admin/storage/location", { preHandler: requireAdmin }, async (request) => {
    requireObjectBody(request.body);

    const { root, move, useDefault } = request.body;
    if (useDefault !== undefined && typeof useDefault !== "boolean") {
      throw httpError(400, "useDefault must be a boolean when provided");
    }
    if (!useDefault && typeof root !== "string") throw httpError(400, "root must be a string");

    return setStorageRoot({ root, move: move ?? false, useDefault: useDefault ?? false }, request.log);
  });

  /** Deletes upload/artwork files that no song row references any more. */
  fastify.post("/api/admin/storage/prune", { preHandler: requireAdmin }, async (request) => {
    const referenced = await prisma.song.findMany({ select: { path: true, artworkPath: true } });
    const keep = new Set([...referenced.map((song) => song.path), ...referenced.map((song) => song.artworkPath)].filter(Boolean));

    const { rm } = await import("node:fs/promises");
    let removedCount = 0;

    for (const directory of [config.uploadDir, config.artworkDir]) {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = join(directory, entry.name);
        if (keep.has(fullPath)) continue;
        try {
          await rm(fullPath, { force: true });
          removedCount += 1;
        } catch (error) {
          request.log.warn({ error, fullPath }, "Failed to prune storage file");
        }
      }
    }

    return { ok: true, removedCount };
  });
}
