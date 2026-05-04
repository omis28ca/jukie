import { defineStore } from "pinia";
import { api } from "../services/api";
import { getSocket } from "../services/socket";

const ADMIN_PIN_KEY = "jukebox-admin-pin";

function formatError(error, fallback) {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const useJukeboxStore = defineStore("jukebox", {
  state: () => ({
    songs: [],
    queue: [],
    player: {
      state: "idle",
      volume: 80,
      nowPlaying: null
    },
    socket: null,
    socketConnected: false,
    initialized: false,
    loading: {
      songs: false,
      queue: false,
      player: false,
      queueAdd: false,
      upload: false,
      admin: false
    },
    statusMessage: "",
    errorMessage: "",
    adminPin: localStorage.getItem(ADMIN_PIN_KEY) || ""
  }),

  getters: {
    isBusy: (state) => Object.values(state.loading).some(Boolean),
    queuedItems: (state) => state.queue.filter((item) => item.status === "queued")
  },

  actions: {
    setStatus(message = "") {
      this.statusMessage = message;
    },

    setError(message = "") {
      this.errorMessage = message;
    },

    setAdminPin(pin) {
      this.adminPin = pin;
      localStorage.setItem(ADMIN_PIN_KEY, pin);
    },

    connectSocket() {
      if (this.socket) return;

      this.socket = getSocket();

      this.socket.on("connect", () => {
        this.socketConnected = true;
      });

      this.socket.on("disconnect", () => {
        this.socketConnected = false;
      });

      this.socket.on("queue:updated", (queue) => {
        this.queue = Array.isArray(queue) ? queue : [];
      });

      this.socket.on("player:state", (player) => {
        if (player && typeof player === "object") {
          this.player = {
            state: player.state || "idle",
            volume: Number.isFinite(player.volume) ? player.volume : 80,
            nowPlaying: player.nowPlaying || null
          };
        }
      });

      this.socket.on("player:now-playing", (song) => {
        this.player.nowPlaying = song || null;
      });

      this.socket.on("song:uploaded", () => {
        this.fetchSongs({ silent: true });
      });
    },

    async init() {
      if (this.initialized) return;
      this.connectSocket();

      await Promise.all([
        this.fetchSongs({ silent: true }),
        this.fetchQueue({ silent: true }),
        this.fetchPlayer({ silent: true })
      ]);

      this.refreshRealtime();
      this.initialized = true;
    },

    refreshRealtime() {
      if (!this.socket) return;
      this.socket.emit("queue:refresh");
      this.socket.emit("player:refresh");
    },

    async fetchSongs({ silent = false } = {}) {
      this.loading.songs = true;
      if (!silent) this.setError("");

      try {
        this.songs = await api.listSongs();
      } catch (error) {
        this.setError(formatError(error, "Failed to load library"));
      } finally {
        this.loading.songs = false;
      }
    },

    async fetchQueue({ silent = false } = {}) {
      this.loading.queue = true;
      if (!silent) this.setError("");

      try {
        this.queue = await api.getQueue();
      } catch (error) {
        this.setError(formatError(error, "Failed to load queue"));
      } finally {
        this.loading.queue = false;
      }
    },

    async fetchPlayer({ silent = false } = {}) {
      this.loading.player = true;
      if (!silent) this.setError("");

      try {
        this.player = await api.getPlayer();
      } catch (error) {
        this.setError(formatError(error, "Failed to load player state"));
      } finally {
        this.loading.player = false;
      }
    },

    async addToQueue(songId, requestedBy = "") {
      this.loading.queueAdd = true;
      this.setError("");
      this.setStatus("");

      try {
        await api.addToQueue(songId, requestedBy.trim());
        this.setStatus("Added to queue.");
        await this.fetchQueue({ silent: true });
      } catch (error) {
        this.setError(formatError(error, "Failed to add song to queue"));
      } finally {
        this.loading.queueAdd = false;
      }
    },

    async uploadSong(formData) {
      this.loading.upload = true;
      this.setError("");
      this.setStatus("");

      try {
        await api.uploadSong(formData);
        this.setStatus("Upload complete.");
        await this.fetchSongs({ silent: true });
      } catch (error) {
        this.setError(formatError(error, "Upload failed"));
        throw error;
      } finally {
        this.loading.upload = false;
      }
    },

    async adminAction(path, body = null) {
      this.loading.admin = true;
      this.setError("");
      this.setStatus("");

      try {
        await api.postAdmin(path, this.adminPin, body);
        this.setStatus("Admin command sent.");
        await this.fetchPlayer({ silent: true });
        await this.fetchQueue({ silent: true });
      } catch (error) {
        this.setError(formatError(error, "Admin command failed"));
      } finally {
        this.loading.admin = false;
      }
    },

    async clearQueue() {
      this.loading.admin = true;
      this.setError("");
      this.setStatus("");

      try {
        const result = await api.clearQueue(this.adminPin);
        const clearedCount = result && Number.isFinite(result.clearedCount) ? result.clearedCount : 0;
        this.setStatus(`Cleared ${clearedCount} queued song(s).`);
        await this.fetchQueue({ silent: true });
      } catch (error) {
        this.setError(formatError(error, "Clear queue failed"));
      } finally {
        this.loading.admin = false;
      }
    }
  }
});
