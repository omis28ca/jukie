import { defineStore } from "pinia";
import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export const useJukeboxStore = defineStore("jukebox", {
  state: () => ({
    songs: [],
    queue: [],
    player: {
      state: "idle",
      volume: 80,
      nowPlaying: null
    },
    socket: null
  }),

  actions: {
    connectSocket() {
      if (this.socket) return;

      this.socket = io(API_BASE);

      this.socket.on("queue:updated", (queue) => {
        this.queue = queue;
      });

      this.socket.on("player:state", (player) => {
        this.player = player;
      });

      this.socket.on("player:now-playing", (song) => {
        this.player.nowPlaying = song;
      });

      this.socket.on("song:uploaded", () => {
        this.fetchSongs();
      });
    },

    async fetchSongs() {
      const response = await fetch(`${API_BASE}/api/songs`);
      this.songs = await response.json();
    },

    async fetchQueue() {
      const response = await fetch(`${API_BASE}/api/queue`);
      this.queue = await response.json();
    },

    async addToQueue(songId, requestedBy = "") {
      await fetch(`${API_BASE}/api/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId, requestedBy })
      });
    },

    async uploadSong(formData) {
      const response = await fetch(`${API_BASE}/api/songs/upload`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      await this.fetchSongs();
    },

    async adminAction(path, body = null, pin = "") {
      await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-pin": pin
        },
        body: body ? JSON.stringify(body) : null
      });
    }
  }
});
