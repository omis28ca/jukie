const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export function resolveApiUrl(path) {
  if (!path || typeof path !== "string") return "";
  if (/^(?:https?:|data:|blob:)/i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      (isJson && data && typeof data === "object" && data.error) ||
      (typeof data === "string" && data) ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  return parseResponse(response);
}

export const api = {
  listSongs() {
    return request("/api/songs");
  },

  searchExternal(provider, query) {
    const params = new URLSearchParams({ provider, q: query });
    return request(`/api/external/search?${params.toString()}`);
  },

  importExternal(provider, sourceId, sourceFile) {
    return request("/api/external/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, sourceId, sourceFile })
    });
  },

  listMoods() {
    return request("/api/moods");
  },

  selectMood(moodId, requestedBy) {
    return request(`/api/moods/${encodeURIComponent(moodId)}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestedBy })
    });
  },

  createMood(name, songIds, pin) {
    return request("/api/moods", {
      method: "POST",
      headers: {
        "x-admin-pin": pin,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name, songIds })
    });
  },

  deleteMood(moodId, pin) {
    return request(`/api/moods/${encodeURIComponent(moodId)}`, {
      method: "DELETE",
      headers: { "x-admin-pin": pin }
    });
  },

  getQueue() {
    return request("/api/queue");
  },

  getPlayer() {
    return request("/api/player");
  },

  getAdminAudioOutputPreference(pin) {
    return request("/api/admin/settings/audio-output", {
      method: "GET",
      headers: {
        "x-admin-pin": pin
      }
    });
  },

  addToQueue(songId, requestedBy, playNext = false) {
    return request("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songId, requestedBy, playNext })
    });
  },

  removeQueueItem(queueItemId) {
    return request(`/api/queue/${encodeURIComponent(queueItemId)}`, {
      method: "DELETE"
    });
  },

  uploadSong(formData) {
    return request("/api/songs/upload", {
      method: "POST",
      body: formData
    });
  },

  deleteSong(songId, pin) {
    return request(`/api/songs/${encodeURIComponent(songId)}`, {
      method: "DELETE",
      headers: {
        "x-admin-pin": pin
      }
    });
  },

  postAdmin(path, pin, body = null) {
    const hasJsonBody = body !== null && body !== undefined;
    const headers = {
      "x-admin-pin": pin
    };

    if (hasJsonBody) {
      headers["Content-Type"] = "application/json";
    }

    return request(path, {
      method: "POST",
      headers,
      body: hasJsonBody ? JSON.stringify(body) : undefined
    });
  },

  clearQueue(pin) {
    return request("/api/queue", {
      method: "DELETE",
      headers: {
        "x-admin-pin": pin
      }
    });
  },

  setAdminAudioOutputPreference(pin, deviceId) {
    return request("/api/admin/settings/audio-output", {
      method: "POST",
      headers: {
        "x-admin-pin": pin,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ deviceId })
    });
  }
};
