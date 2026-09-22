import { networkInterfaces } from "node:os";
import { config } from "../config.js";
import { prisma } from "../db.js";

function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

/** Builds the URL guests should open after scanning the QR code. */
function resolveJoinUrl(request) {
  if (config.publicUrl) return config.publicUrl;

  const host = String(request.headers.host || "");
  const protocol = request.protocol || "http";
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

  if (host && !isLoopback) return `${protocol}://${host}`;

  const lan = lanAddress();
  return lan ? `${protocol}://${lan}:${config.port}` : `${protocol}://${host || `localhost:${config.port}`}`;
}

export async function infoRoutes(fastify) {
  fastify.get("/api/info", async (request) => {
    return {
      name: "Jukie",
      version: "1.0.0",
      joinUrl: resolveJoinUrl(request)
    };
  });

  fastify.get("/api/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, uptimeSeconds: Math.round(process.uptime()) };
  });
}
