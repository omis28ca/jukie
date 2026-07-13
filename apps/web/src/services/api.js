const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

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

  getQueue() {
    return request("/api/queue");
  },

  getPlayer() {
    return request("/api/player");
  },

  addToQueue(songId, requestedBy) {
    return request("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songId, requestedBy })
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
  }
};

