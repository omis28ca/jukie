import { config } from "../config.js";
import { httpError } from "./http.js";

const MAX_NAME_LENGTH = 40;

function decodeHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

export function isAdminRequest(request) {
  const providedPin = decodeHeaderValue(request.headers["x-admin-pin"]);
  return Boolean(providedPin) && providedPin === config.adminPin && /^\d{4}$/.test(config.adminPin);
}

/**
 * Resolves the caller identity. The display name comes from the join screen
 * (`x-jukebox-user`) or an explicit `requestedBy` body field; the stable key falls back to the
 * client IP so anonymous guests still get per-person queue limits and one vote per track.
 */
export function getRequester(request) {
  const headerName = decodeHeaderValue(request.headers["x-jukebox-user"]);
  const bodyName = typeof request.body?.requestedBy === "string" ? request.body.requestedBy.trim() : "";
  const name = (headerName || bodyName).slice(0, MAX_NAME_LENGTH);

  if ((headerName || bodyName).length > MAX_NAME_LENGTH) {
    throw httpError(400, `Name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }

  return {
    name: name || null,
    key: name || `ip:${request.ip}`,
    isAdmin: isAdminRequest(request)
  };
}

export function requireAdmin(request, reply, done) {
  if (!/^\d{4}$/.test(config.adminPin)) {
    reply.code(503).send({ error: "Admin PIN is not configured as four digits" });
    return;
  }

  if (!isAdminRequest(request)) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }

  done();
}
