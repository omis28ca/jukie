import { defineStore } from "pinia";
import { api } from "../services/api";
import { getSocket } from "../services/socket";

const ADMIN_PIN_KEY = "jukebox-admin-pin";
const ADMIN_PIN_PATTERN = /^\d{4}$/;
const ADMIN_AUTH_CANCELLED = "ADMIN_AUTH_CANCELLED";

let adminPinPromptResolver = null;
let adminPinPromptPromise = null;
let externalSearchRequestId = 0;

function formatError(error, fallback) {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isUnauthorizedError(error) {
  return String(error?.message || "").trim().toLowerCase() === "unauthorized";
}

export const useJukeboxStore = defineStore("jukebox", {
  state: () => ({
    songs: [],
    externalResults: [],
    moods: [],
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
      externalSearch: false,
      externalImport: false,
      moods: false,
      moodSelect: false,
      queue: false,
      player: false,
      queueAdd: false,
      upload: false,
      admin: false
    },
    statusMessage: "",
    errorMessage: "",
    adminPin: localStorage.getItem(ADMIN_PIN_KEY) || "",
    adminPrompt: {
      open: false,
      pin: ""
    }
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

    clearExternalSearch() {
      externalSearchRequestId += 1;
      this.externalResults = [];
      this.loading.externalSearch = false;
    },

    setAdminPin(pin) {
      const normalizedPin = String(pin ?? "").replace(/\D/g, "").slice(0, 4);
      this.adminPin = normalizedPin;
      if (normalizedPin) {
        localStorage.setItem(ADMIN_PIN_KEY, normalizedPin);
        return;
      }
      localStorage.removeItem(ADMIN_PIN_KEY);
    },

    clearAdminPin() {
      this.setAdminPin("");
    },

    openAdminPinPrompt() {
      if (adminPinPromptPromise) return adminPinPromptPromise;
      this.adminPrompt.open = true;
      this.adminPrompt.pin = "";
      adminPinPromptPromise = new Promise((resolve) => {
        adminPinPromptResolver = resolve;
      });
      return adminPinPromptPromise;
    },

    appendAdminPinDigit(digit) {
      const nextDigit = String(digit ?? "");
      if (!/^\d$/.test(nextDigit) || !this.adminPrompt.open) return;
      if (this.adminPrompt.pin.length >= 4) return;
      this.adminPrompt.pin += nextDigit;
    },

    removeAdminPinDigit() {
      if (!this.adminPrompt.open) return;
      this.adminPrompt.pin = this.adminPrompt.pin.slice(0, -1);
    },

    clearAdminPinEntry() {
      if (!this.adminPrompt.open) return;
      this.adminPrompt.pin = "";
    },

    cancelAdminPinPrompt() {
      if (!this.adminPrompt.open) return;
      this.adminPrompt.open = false;
      this.adminPrompt.pin = "";
      if (adminPinPromptResolver) {
        adminPinPromptResolver(null);
      }
      adminPinPromptResolver = null;
      adminPinPromptPromise = null;
    },

    submitAdminPinPrompt() {
      if (!this.adminPrompt.open || !ADMIN_PIN_PATTERN.test(this.adminPrompt.pin)) return;
      const pin = this.adminPrompt.pin;
      this.setAdminPin(pin);
      this.adminPrompt.open = false;
      this.adminPrompt.pin = "";
      if (adminPinPromptResolver) {
        adminPinPromptResolver(pin);
      }
      adminPinPromptResolver = null;
      adminPinPromptPromise = null;
    },

    async requestAdminPin({ forcePrompt = false } = {}) {
      if (!forcePrompt && ADMIN_PIN_PATTERN.test(this.adminPin)) {
        return this.adminPin;
      }
      const pin = await this.openAdminPinPrompt();
      return ADMIN_PIN_PATTERN.test(pin) ? pin : null;
    },

    async runAdminRequest(requestFn) {
      let pin = await this.requestAdminPin();
      if (!pin) throw new Error(ADMIN_AUTH_CANCELLED);

      try {
        return await requestFn(pin);
      } catch (error) {
        if (!isUnauthorizedError(error)) throw error;
      }

      this.clearAdminPin();
      this.setError("Incorrect admin PIN.");

      pin = await this.requestAdminPin({ forcePrompt: true });
      if (!pin) throw new Error(ADMIN_AUTH_CANCELLED);
      return requestFn(pin);
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

      this.socket.on("songs:updated", () => {
        this.fetchSongs({ silent: true });
      });

      this.socket.on("moods:updated", (moods) => {
        this.moods = Array.isArray(moods) ? moods : [];
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
          this.fetchMoods({ silent: true }),
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
      this.socket.emit("moods:refresh");
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

    async searchExternal(provider, query) {
      const requestId = ++externalSearchRequestId;
      this.loading.externalSearch = true;
      this.setError("");
      this.setStatus("");

      try {
        const results = await api.searchExternal(provider, query.trim());
        if (requestId === externalSearchRequestId) this.externalResults = results;
      } catch (error) {
        if (requestId !== externalSearchRequestId) return;
        this.externalResults = [];
        this.setError(formatError(error, "External music search failed"));
      } finally {
        if (requestId === externalSearchRequestId) this.loading.externalSearch = false;
      }
    },

    async importExternal(result, requestedBy = "", queueAfterImport = false) {
      this.loading.externalImport = true;
      this.setError("");
      this.setStatus("");

      try {
        const imported = await api.importExternal(result.provider, result.sourceId, result.sourceFile);
        const song = imported.song;
        const externalResult = this.externalResults.find((entry) =>
          entry.provider === result.provider && entry.id === result.id
        );
        if (externalResult) externalResult.importedSongId = song.id;
        await this.fetchSongs({ silent: true });

        if (queueAfterImport) {
          try {
            await api.addToQueue(song.id, requestedBy.trim(), false);
            await this.fetchQueue({ silent: true });
            this.setStatus(imported.alreadyImported ? "Already in the library and added to queue." : "Imported and added to queue.");
          } catch (error) {
            this.setStatus(imported.alreadyImported ? "Song is already in the library." : "Song imported to the library.");
            this.setError(`Imported, but could not add to queue: ${formatError(error, "Queue request failed")}`);
          }
        } else {
          this.setStatus(imported.alreadyImported ? "Song is already in the library." : "Song imported to the library.");
        }
        return song;
      } catch (error) {
        this.setError(formatError(error, "External song import failed"));
        return null;
      } finally {
        this.loading.externalImport = false;
      }
    },

    async fetchMoods({ silent = false } = {}) {
      this.loading.moods = true;
      if (!silent) this.setError("");

      try {
        this.moods = await api.listMoods();
      } catch (error) {
        this.setError(formatError(error, "Failed to load moods"));
      } finally {
        this.loading.moods = false;
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
        const preference = await this.runAdminRequest((pin) => api.getAdminAudioOutputPreference(pin));
        this.player.audioOutput = {
          deviceId: typeof preference?.deviceId === "string" ? preference.deviceId : "auto",
          applied: typeof preference?.applied === "boolean" ? preference.applied : null,
          message: typeof preference?.message === "string" ? preference.message : "",
          lastAttemptAt: typeof preference?.lastAttemptAt === "string" ? preference.lastAttemptAt : null
        };
      } catch (error) {
        if (error?.message === ADMIN_AUTH_CANCELLED) return;
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
        const result = await this.runAdminRequest((pin) => api.setAdminAudioOutputPreference(pin, deviceId));
        this.player.audioOutput = {
          deviceId: typeof result?.deviceId === "string" ? result.deviceId : "auto",
          applied: typeof result?.applied === "boolean" ? result.applied : null,
          message: typeof result?.message === "string" ? result.message : "",
          lastAttemptAt: typeof result?.lastAttemptAt === "string" ? result.lastAttemptAt : null
        };
        this.setStatus(result?.message || "Audio output preference saved.");
        await this.fetchPlayer({ silent: true });
      } catch (error) {
        if (error?.message === ADMIN_AUTH_CANCELLED) return;
        this.setError(formatError(error, "Saving audio output preference failed"));
      } finally {
        this.loading.admin = false;
      }
    },

    async addToQueue(songId, requestedBy = "", playNext = false) {
      this.loading.queueAdd = true;
      this.setError("");
      this.setStatus("");

      try {
        await api.addToQueue(songId, requestedBy.trim(), playNext);
        this.setStatus(playNext ? "Added to play next." : "Added to queue.");
        await this.fetchQueue({ silent: true });
      } catch (error) {
        this.setError(formatError(error, "Failed to add song to queue"));
      } finally {
        this.loading.queueAdd = false;
      }
    },

    async selectMood(moodId, requestedBy = "") {
      this.loading.moodSelect = true;
      this.setError("");
      this.setStatus("");

      try {
        const result = await api.selectMood(moodId, requestedBy.trim());
        this.setStatus(`${result.name} loaded with ${result.queuedCount} song(s).`);
        await this.fetchQueue({ silent: true });
      } catch (error) {
        this.setError(formatError(error, "Failed to load mood"));
      } finally {
        this.loading.moodSelect = false;
      }
    },

    async createMood(name, songIds) {
      this.loading.admin = true;
      this.setError("");
      this.setStatus("");

      try {
        const mood = await this.runAdminRequest((pin) => api.createMood(name.trim(), songIds, pin));
        this.setStatus(`Created mood “${mood.name}”.`);
        await this.fetchMoods({ silent: true });
        return mood;
      } catch (error) {
        if (error?.message === ADMIN_AUTH_CANCELLED) return null;
        this.setError(formatError(error, "Creating mood failed"));
        return null;
      } finally {
        this.loading.admin = false;
      }
    },

    async deleteMood(moodId) {
      this.loading.admin = true;
      this.setError("");
      this.setStatus("");

      try {
        await this.runAdminRequest((pin) => api.deleteMood(moodId, pin));
        this.setStatus("Mood deleted.");
        await this.fetchMoods({ silent: true });
      } catch (error) {
        if (error?.message === ADMIN_AUTH_CANCELLED) return;
        this.setError(formatError(error, "Deleting mood failed"));
      } finally {
        this.loading.admin = false;
      }
    },

    async removeQueueItem(queueItemId) {
      this.loading.queueAdd = true;
      this.setError("");
      this.setStatus("");

      try {
        await api.removeQueueItem(queueItemId);
        this.setStatus("Removed from queue.");
        await this.fetchQueue({ silent: true });
      } catch (error) {
        this.setError(formatError(error, "Failed to remove queued item"));
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
        await this.runAdminRequest((pin) => api.postAdmin(path, pin, body));
        this.setStatus("Admin command sent.");
        await this.fetchPlayer({ silent: true });
        await this.fetchQueue({ silent: true });
      } catch (error) {
        if (error?.message === ADMIN_AUTH_CANCELLED) return;
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
        const result = await this.runAdminRequest((pin) => api.clearQueue(pin));
        const clearedCount = result && Number.isFinite(result.clearedCount) ? result.clearedCount : 0;
        this.setStatus(`Cleared ${clearedCount} queued song(s).`);
        await this.fetchQueue({ silent: true });
      } catch (error) {
        if (error?.message === ADMIN_AUTH_CANCELLED) return;
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
        await this.runAdminRequest((pin) => api.deleteSong(songId, pin));
        this.setStatus("Song deleted.");
        await this.fetchSongs({ silent: true });
        await this.fetchQueue({ silent: true });
        await this.fetchPlayer({ silent: true });
      } catch (error) {
        if (error?.message === ADMIN_AUTH_CANCELLED) return;
        this.setError(formatError(error, "Delete song failed"));
      } finally {
        this.loading.admin = false;
      }
    }
  }
});
