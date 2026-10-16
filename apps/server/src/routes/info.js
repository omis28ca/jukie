import { networkInterfaces } from "node:os";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { getHotspotSetupInfo } from "../services/wifi.js";

function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

/**
 * True only for the kiosk browser on the box itself: a loopback socket with no proxy headers, so
 * requests relayed by a tunnel or reverse proxy (which also arrive on loopback) do not count.
 */
function isOnDeviceRequest(request) {
  const remote = request.raw.socket?.remoteAddress || "";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const proxied = ["x-forwarded-for", "cf-connecting-ip", "x-real-ip", "forwarded"].some((name) => request.headers[name]);
  return loopback && !proxied;
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
    const hotspot = await getHotspotSetupInfo();
    return {
      name: "IrDJ",
      version: "1.0.0",
      joinUrl: resolveJoinUrl(request),
      // While the Wi-Fi setup hotspot is up, the kiosk screen shows how to join it. The password
      // only goes to the kiosk itself; phones already on the hotspot know it.
      wifiSetup: hotspot
        ? {
            ssid: hotspot.ssid,
            url: hotspot.url,
            ...(isOnDeviceRequest(request) ? { password: hotspot.password } : {})
          }
        : null
    };
  });

  fastify.get("/api/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, uptimeSeconds: Math.round(process.uptime()) };
  });
}
