import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { setRuntime } from "./runtime.js";
import { createRealtime } from "./realtime.js";
import { createPlayerService } from "./services/player.js";
import { createImportWatcher, recoverFolderImports } from "./services/imports.js";
import { createMqttBridge } from "./services/mqtt.js";
import { getAudioOutputSetting } from "./services/settings.js";
import { loadStorageRoot } from "./services/storage.js";
import { songRoutes } from "./routes/songs.js";
import { queueRoutes } from "./routes/queue.js";
import { playerRoutes } from "./routes/player.js";
import { moodRoutes } from "./routes/moods.js";
import { adminRoutes } from "./routes/admin.js";
import { externalRoutes } from "./routes/external.js";
import { chatRoutes } from "./routes/chat.js";
import { infoRoutes } from "./routes/info.js";

// A saved storage drive overrides the environment layout before anything touches the disk.
await loadStorageRoot(console);

await Promise.all([
  mkdir(config.uploadDir, { recursive: true }),
  mkdir(config.artworkDir, { recursive: true }),
  mkdir(config.importDir, { recursive: true })
]);

const fastify = Fastify({ logger: true, trustProxy: config.trustProxy });

await fastify.register(cors, { origin: true });
await fastify.register(multipart, { limits: { fileSize: config.uploadMaxBytes } });

const realtime = createRealtime(fastify.server);
const player = createPlayerService({
  prisma,
  io: realtime.io,
  emitQueueUpdated: realtime.broadcastQueue,
  deferStartup: true
});
const mqttBridge = createMqttBridge(fastify.log);

setRuntime({ player, realtime, logger: fastify.log });
realtime.onBroadcast((event, payload) => {
  if (event === "player:state") mqttBridge.publishState(payload);
});

fastify.setErrorHandler((error, request, reply) => {
  if (error?.code === "FST_REQ_FILE_TOO_LARGE") {
    return reply.code(413).send({ error: `Upload exceeds ${config.maxUploadMb}MB limit` });
  }

  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (statusCode >= 500) request.log.error(error);
  return reply.code(statusCode).send({ error: error.message || "Internal server error" });
});

await fastify.register(infoRoutes);
await fastify.register(songRoutes);
await fastify.register(queueRoutes);
await fastify.register(playerRoutes);
await fastify.register(moodRoutes);
await fastify.register(adminRoutes);
await fastify.register(externalRoutes);
await fastify.register(chatRoutes);

// Serve the built web app when it exists so a production install is a single process.
if (existsSync(join(config.webDist, "index.html"))) {
  await fastify.register(fastifyStatic, { root: config.webDist });
  fastify.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
  fastify.log.info({ webDist: config.webDist }, "Serving built web app");
} else {
  fastify.setNotFoundHandler((request, reply) => reply.code(404).send({ error: "Not found" }));
  fastify.log.warn({ webDist: config.webDist }, "Web app build not found; run `npm run build` in apps/web");
}

const folderImporter = createImportWatcher(fastify.log);
setRuntime({ folderImporter });

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
    await mqttBridge.stop();
    await fastify.close();
    await prisma.$disconnect();
    process.exit(0);
  })().catch((error) => {
    fastify.log.error(error, "Server shutdown failed");
    process.exit(1);
  });
  return shutdownPromise;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  await fastify.listen({ port: config.port, host: config.host });
  fastify.log.info(
    { playerExec: config.playerExec, audioProbeExec: config.audioProbeExec, audioTranscodeExec: config.audioTranscodeExec },
    "Jukie server started"
  );

  if (!isShuttingDown) await player.cleanupOrphanedPlayback();
  if (!isShuttingDown) {
    await player.setPreferredAudioOutputDevice(await getAudioOutputSetting());
    await prisma.queueItem.updateMany({ where: { status: "playing" }, data: { status: "queued" } });
  }
  if (!isShuttingDown) await recoverFolderImports();
  if (!isShuttingDown) await player.activate();
  if (!isShuttingDown) {
    await folderImporter.start();
    fastify.log.info(
      { importDir: config.importDir, pollMs: config.importPollMs, settleMs: config.importSettleMs },
      "Folder import inbox started"
    );
  }
  if (!isShuttingDown && mqttBridge.enabled) await mqttBridge.start();
} catch (error) {
  if (!isShuttingDown) {
    isShuttingDown = true;
    await folderImporter.stop();
    await player.shutdown();
    await mqttBridge.stop();
    await fastify.close();
    await prisma.$disconnect();
  }
  throw error;
}
