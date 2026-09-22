import { getRequester, requireAdmin } from "../lib/identity.js";
import { createRateLimiter, httpError, requireObjectBody } from "../lib/http.js";
import { chatSnapshot, clearChatMessages, postChatMessage } from "../services/chat.js";

const postLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export async function chatRoutes(fastify) {
  fastify.get("/api/chat", async () => chatSnapshot());

  fastify.post("/api/chat", async (request, reply) => {
    const body = requireObjectBody(request.body);
    const requester = getRequester(request);

    if (!requester.isAdmin && !postLimiter(requester.key)) {
      throw httpError(429, "Too many messages — wait a minute");
    }

    const message = postChatMessage({ requester, body: body.body ?? body.message });
    return reply.code(201).send({ message });
  });

  fastify.delete("/api/chat", { preHandler: requireAdmin }, async () => clearChatMessages());
}
