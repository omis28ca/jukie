import { httpError, requireObjectBody } from "../lib/http.js";
import { getRequester, requireAdmin } from "../lib/identity.js";
import { runtime } from "../runtime.js";
import { getPlayingItem } from "../services/queue.js";

async function assertCanControlPlayback(request) {
  const viewer = getRequester(request);
  if (viewer.isAdmin) return viewer;

  const playing = await getPlayingItem();
  if (!playing) throw httpError(409, "Nothing is playing right now");
  if (playing.requesterKey !== viewer.key) {
    throw httpError(403, "Only the requester of the current track or an admin can do that");
  }
  return viewer;
}

export async function playerRoutes(fastify) {
  fastify.get("/api/player", async () => {
    return runtime.player.getState();
  });

  fastify.post("/api/player/skip", async (request) => {
    await assertCanControlPlayback(request);
    await runtime.player.skip();
    return { ok: true };
  });

  fastify.post("/api/player/pause", async (request) => {
    await assertCanControlPlayback(request);
    await runtime.player.pause();
    return { ok: true };
  });

  fastify.post("/api/player/resume", async (request) => {
    await assertCanControlPlayback(request);
    await runtime.player.resume();
    return { ok: true };
  });

  fastify.post("/api/player/stop", { preHandler: requireAdmin }, async () => {
    await runtime.player.stop();
    return { ok: true };
  });

  fastify.post("/api/player/start", { preHandler: requireAdmin }, async () => {
    await runtime.player.start();
    return { ok: true };
  });

  fastify.post("/api/player/seek", async (request) => {
    requireObjectBody(request.body);
    await assertCanControlPlayback(request);

    const positionSeconds = Number(request.body.positionSeconds);
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
      throw httpError(400, "positionSeconds must be a non-negative number");
    }

    await runtime.player.seek(positionSeconds);
    return { ok: true };
  });

  fastify.post("/api/player/volume", async (request) => {
    requireObjectBody(request.body);

    const volume = Number(request.body.volume);
    if (!Number.isFinite(volume)) throw httpError(400, "volume must be a number");
    if (volume < 0 || volume > 100) throw httpError(400, "volume must be between 0 and 100");

    await runtime.player.setVolume(volume);
    return { ok: true, volume: runtime.player.getState().volume };
  });

  fastify.post("/api/player/loop", async (request) => {
    requireObjectBody(request.body);

    const { enabled } = request.body;
    if (typeof enabled !== "boolean") throw httpError(400, "enabled must be a boolean");

    await runtime.player.setLoopQueue(enabled);
    return { ok: true, loopQueue: enabled };
  });
}
