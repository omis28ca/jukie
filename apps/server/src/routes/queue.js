import { httpError, requireObjectBody } from "../lib/http.js";
import { getRequester } from "../lib/identity.js";
import { runtime } from "../runtime.js";
import {
  authorizeTransport,
  clearQueue,
  downvoteQueueItem,
  enqueueSong,
  getHistory,
  getQueueSnapshot,
  playNow,
  removeQueueItem,
  shuffleQueue,
  setPlayNext,
  upvoteQueueItem
} from "../services/queue.js";

function assertIsPlaying(item) {
  if (item.status !== "playing") throw httpError(409, "This track is not playing right now");
  return item;
}

export async function queueRoutes(fastify) {
  fastify.get("/api/queue", async (request) => {
    return getQueueSnapshot(getRequester(request));
  });

  fastify.get("/api/queue/history", async (request) => {
    return { history: await getHistory({ limit: request.query?.limit }) };
  });

  fastify.post("/api/queue", async (request, reply) => {
    requireObjectBody(request.body);
    const viewer = getRequester(request);
    const item = await enqueueSong({
      songId: request.body.songId,
      viewer,
      playNext: request.body.playNext ?? false
    });
    return reply.code(201).send({ item });
  });

  fastify.delete("/api/queue/:id", async (request) => {
    return removeQueueItem(request.params?.id, getRequester(request));
  });

  fastify.delete("/api/queue", async (request) => {
    return clearQueue(getRequester(request));
  });

  fastify.post("/api/queue/shuffle", async (request) => {
    return shuffleQueue(getRequester(request));
  });

  fastify.post("/api/queue/:id/vote", async (request) => {
    return downvoteQueueItem(request.params?.id, getRequester(request));
  });

  fastify.post("/api/queue/:id/upvote", async (request) => {
    return upvoteQueueItem(request.params?.id, getRequester(request));
  });

  fastify.post("/api/queue/:id/play-next", async (request) => {
    return setPlayNext(request.params?.id, getRequester(request), true);
  });

  fastify.post("/api/queue/:id/remove-play-next", async (request) => {
    return setPlayNext(request.params?.id, getRequester(request), false);
  });

  fastify.post("/api/queue/:id/now-playing", async (request) => {
    return playNow(request.params?.id, getRequester(request));
  });

  fastify.post("/api/queue/:id/clear", async (request) => {
    await authorizeTransport(request.params?.id, getRequester(request));
    return clearQueue(getRequester(request));
  });

  fastify.post("/api/queue/:id/skip", async (request) => {
    assertIsPlaying(await authorizeTransport(request.params?.id, getRequester(request)));
    await runtime.player.skip();
    return { ok: true };
  });

  fastify.post("/api/queue/:id/pause", async (request) => {
    assertIsPlaying(await authorizeTransport(request.params?.id, getRequester(request)));
    await runtime.player.pause();
    return { ok: true };
  });

  fastify.post("/api/queue/:id/resume", async (request) => {
    assertIsPlaying(await authorizeTransport(request.params?.id, getRequester(request)));
    await runtime.player.resume();
    return { ok: true };
  });

  fastify.post("/api/queue/:id/stop", async (request) => {
    await authorizeTransport(request.params?.id, getRequester(request));
    await runtime.player.stop();
    return { ok: true };
  });

  fastify.post("/api/queue/:id/start", async (request) => {
    await authorizeTransport(request.params?.id, getRequester(request));
    await runtime.player.start();
    return { ok: true };
  });

  fastify.post("/api/queue/:id/seek", async (request) => {
    requireObjectBody(request.body);
    assertIsPlaying(await authorizeTransport(request.params?.id, getRequester(request)));

    const positionSeconds = Number(request.body.positionSeconds);
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
      throw httpError(400, "positionSeconds must be a non-negative number");
    }

    await runtime.player.seek(positionSeconds);
    return { ok: true };
  });

  fastify.post("/api/queue/:id/volume", async (request) => {
    requireObjectBody(request.body);
    await authorizeTransport(request.params?.id, getRequester(request));

    const volume = Number(request.body.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 100) {
      throw httpError(400, "volume must be between 0 and 100");
    }

    await runtime.player.setVolume(volume);
    return { ok: true };
  });

  fastify.post("/api/queue/:id/loop", async (request) => {
    requireObjectBody(request.body);
    await authorizeTransport(request.params?.id, getRequester(request));

    const { enabled } = request.body;
    if (typeof enabled !== "boolean") throw httpError(400, "enabled must be a boolean");

    await runtime.player.setLoopQueue(enabled);
    return { ok: true, loopQueue: enabled };
  });
}
