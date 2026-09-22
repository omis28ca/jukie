import { requireObjectBody } from "../lib/http.js";
import { getRequester, requireAdmin } from "../lib/identity.js";
import {
  createMood,
  createMoodFromHistory,
  deleteMood,
  getMood,
  listMoods,
  selectMood,
  updateMood
} from "../services/moods.js";

export async function moodRoutes(fastify) {
  fastify.get("/api/moods", async () => {
    return { moods: await listMoods() };
  });

  fastify.get("/api/moods/:id", async (request) => {
    return getMood(request.params?.id);
  });

  fastify.post("/api/moods", { preHandler: requireAdmin }, async (request, reply) => {
    requireObjectBody(request.body);
    return reply.code(201).send(await createMood(request.body));
  });

  fastify.post("/api/moods/from-history", { preHandler: requireAdmin }, async (request, reply) => {
    requireObjectBody(request.body);
    return reply.code(201).send(await createMoodFromHistory(request.body));
  });

  fastify.put("/api/moods/:id", { preHandler: requireAdmin }, async (request) => {
    requireObjectBody(request.body);
    return updateMood(request.params?.id, request.body);
  });

  fastify.delete("/api/moods/:id", { preHandler: requireAdmin }, async (request) => {
    return deleteMood(request.params?.id);
  });

  fastify.post("/api/moods/:id/select", async (request) => {
    return selectMood(request.params?.id, getRequester(request));
  });
}
