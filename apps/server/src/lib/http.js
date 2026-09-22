export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function createRateLimiter({ limit, windowMs, maxKeys = 10000 }) {
  const windows = new Map();

  return function consume(key) {
    const now = Date.now();
    if (windows.size > maxKeys) {
      for (const [windowKey, value] of windows) {
        if (value.resetAt <= now) windows.delete(windowKey);
      }
      if (windows.size > maxKeys) windows.delete(windows.keys().next().value);
    }

    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  };
}

export function asTrimmedString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function requireObjectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Request body must be a JSON object");
  }
  return body;
}
