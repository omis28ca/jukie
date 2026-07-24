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
      nowPlaying: null,
      positionSeconds: 0,
      loopQueue: false,
      audioOutput: {
        deviceId: "auto",
        applied: null,
        message: "",
        lastAttemptAt: null
      }
    },
    socket: null,
    socketConnected: false,
    initializing: false,
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
        this.refreshRealtime();
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
            nowPlaying: player.nowPlaying || null,
            positionSeconds: Number.isFinite(player.positionSeconds) ? player.positionSeconds : 0,
            loopQueue: Boolean(player.loopQueue),
            audioOutput: {
              deviceId: typeof player.audioOutput?.deviceId === "string" ? player.audioOutput.deviceId : "auto",
              applied: typeof player.audioOutput?.applied === "boolean" ? player.audioOutput.applied : null,
              message: typeof player.audioOutput?.message === "string" ? player.audioOutput.message : "",
              lastAttemptAt: typeof player.audioOutput?.lastAttemptAt === "string" ? player.audioOutput.lastAttemptAt : null
            }
          };
        }
      });

      this.socket.on("player:now-playing", (song) => {
        this.player.nowPlaying = song || null;
      });

      this.socket.on("song:uploaded", () => {
        this.fetchSongs({ silent: true });
      });

      this.socket.on("player:error", (error) => {
        const message = typeof error === "string" ? error : error?.message;
        this.setError(message || "The audio player reported an error.");
      });
    },

    async init() {
      if (this.initialized || this.initializing) return;
      this.initializing = true;
      this.connectSocket();

      try {
        await Promise.all([
          this.fetchSongs({ silent: true }),
          this.fetchQueue({ silent: true }),
          this.fetchPlayer({ silent: true })
        ]);

        this.refreshRealtime();
        this.initialized = true;
      } finally {
        this.initializing = false;
      }
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
        const player = await api.getPlayer();
        this.player = {
          state: player?.state || "idle",
          volume: Number.isFinite(player?.volume) ? player.volume : 80,
          nowPlaying: player?.nowPlaying || null,
          positionSeconds: Number.isFinite(player?.positionSeconds) ? player.positionSeconds : 0,
          loopQueue: Boolean(player?.loopQueue),
          audioOutput: {
            deviceId: typeof player?.audioOutput?.deviceId === "string" ? player.audioOutput.deviceId : "auto",
            applied: typeof player?.audioOutput?.applied === "boolean" ? player.audioOutput.applied : null,
            message: typeof player?.audioOutput?.message === "string" ? player.audioOutput.message : "",
            lastAttemptAt: typeof player?.audioOutput?.lastAttemptAt === "string" ? player.audioOutput.lastAttemptAt : null
          }
        };
      } catch (error) {
        this.setError(formatError(error, "Failed to load player state"));
      } finally {
        this.loading.player = false;
      }
    },

    async fetchAudioOutputPreference() {
      this.loading.admin = true;
      this.setError("");

      try {
        const preference = await api.getAdminAudioOutputPreference(this.adminPin);
        this.player.audioOutput = {
          deviceId: typeof preference?.deviceId === "string" ? preference.deviceId : "auto",
          applied: typeof preference?.applied === "boolean" ? preference.applied : null,
          message: typeof preference?.message === "string" ? preference.message : "",
          lastAttemptAt: typeof preference?.lastAttemptAt === "string" ? preference.lastAttemptAt : null
        };
      } catch (error) {
        this.setError(formatError(error, "Failed to load audio output preference"));
      } finally {
        this.loading.admin = false;
      }
    },

    async saveAudioOutputPreference(deviceId) {
      this.loading.admin = true;
      this.setError("");
      this.setStatus("");

      try {
        const result = await api.setAdminAudioOutputPreference(this.adminPin, deviceId);
        this.player.audioOutput = {
          deviceId: typeof result?.deviceId === "string" ? result.deviceId : "auto",
          applied: typeof result?.applied === "boolean" ? result.applied : null,
          message: typeof result?.message === "string" ? result.message : "",
          lastAttemptAt: typeof result?.lastAttemptAt === "string" ? result.lastAttemptAt : null
        };
        this.setStatus(result?.message || "Audio output preference saved.");
        await this.fetchPlayer({ silent: true });
      } catch (error) {
        this.setError(formatError(error, "Saving audio output preference failed"));
      } finally {
        this.loading.admin = false;
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
        const uploadedSong = await api.uploadSong(formData);
        this.setStatus("Upload complete.");
        await this.fetchSongs({ silent: true });
        return uploadedSong;
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
    },

    async deleteSong(songId) {
      this.loading.admin = true;
      this.setError("");
      this.setStatus("");

      try {
        await api.deleteSong(songId, this.adminPin);
        this.setStatus("Song deleted.");
        await this.fetchSongs({ silent: true });
        await this.fetchQueue({ silent: true });
        await this.fetchPlayer({ silent: true });
      } catch (error) {
        this.setError(formatError(error, "Delete song failed"));
      } finally {
        this.loading.admin = false;
      }
    }
  }
});
