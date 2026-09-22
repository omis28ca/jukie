import { defineStore } from 'pinia';
import { api } from '../lib/api';
import { useUiStore } from './ui';

export const useQueueStore = defineStore('queue', {
  state: () => ({
    queue: [],
    nowPlaying: null,
    loading: false,
    loaded: false,
    history: [],
    historyLoading: false,
    historyLoaded: false
  }),
  getters: {
    count: (state) => state.queue.length,
    upcoming: (state) => state.queue.filter((item) => item.status !== 'playing'),
    mine: (state) => state.queue.filter((item) => item.isMine)
  },
  actions: {
    applySnapshot(payload) {
      if (!payload || typeof payload !== 'object') return;
      this.queue = Array.isArray(payload.queue) ? payload.queue : [];
      this.nowPlaying = payload.nowPlaying ?? null;
      this.loaded = true;
    },
    async fetch() {
      this.loading = true;
      try {
        const payload = await api.get('/api/queue');
        this.applySnapshot(payload);
      } catch (error) {
        useUiStore().error(error);
      } finally {
        this.loading = false;
      }
    },
    /** Recently played/skipped tracks, newest first. */
    async fetchHistory(limit = 50) {
      this.historyLoading = true;
      try {
        const payload = await api.get(`/api/queue/history?limit=${encodeURIComponent(limit)}`);
        this.history = Array.isArray(payload?.history) ? payload.history : [];
        this.historyLoaded = true;
        return this.history;
      } catch (error) {
        useUiStore().error(error);
        throw error;
      } finally {
        this.historyLoading = false;
      }
    },
    /** Refresh silently after a track change so the history feed stays current. */
    refreshHistory() {
      if (!this.historyLoaded) return;
      this.fetchHistory().catch(() => {});
    },
    async enqueue(songId, { playNext = false } = {}) {
      const ui = useUiStore();
      try {
        const result = await api.post('/api/queue', { songId, playNext });
        ui.success(playNext ? 'Queued to play next' : 'Added to the queue');
        await this.fetch();
        return result?.item ?? null;
      } catch (error) {
        ui.error(error);
        throw error;
      }
    },
    async remove(id) {
      const ui = useUiStore();
      const snapshot = this.queue;
      this.queue = this.queue.filter((item) => item.id !== id);
      try {
        await api.del(`/api/queue/${encodeURIComponent(id)}`);
        ui.success('Removed from the queue');
        await this.fetch();
      } catch (error) {
        this.queue = snapshot;
        ui.error(error);
        throw error;
      }
    },
    async clear() {
      const ui = useUiStore();
      try {
        await api.del('/api/queue');
        ui.success('Queue cleared');
        await this.fetch();
      } catch (error) {
        ui.error(error);
        throw error;
      }
    },
    async itemAction(id, action, body, successMessage) {
      const ui = useUiStore();
      try {
        const result = await api.post(`/api/queue/${encodeURIComponent(id)}/${action}`, body);
        if (successMessage) ui.success(successMessage);
        await this.fetch();
        return result;
      } catch (error) {
        ui.error(error);
        throw error;
      }
    },
    async upvote(id) {
      const item = this.queue.find((entry) => entry.id === id);
      if (item) item.playNext = true;
      return this.itemAction(id, 'upvote', undefined, 'Upvoted — playing next and saved to the mood');
    },
    async downvote(id) {
      const item = this.queue.find((entry) => entry.id === id);
      if (item) {
        item.hasDownvoted = true;
        item.downvotes = (item.downvotes || 0) + 1;
      }
      return this.itemAction(id, 'vote', undefined, 'Downvoted');
    },
    async playNext(id) {
      const item = this.queue.find((entry) => entry.id === id);
      if (item) item.playNext = true;
      return this.itemAction(id, 'play-next', undefined, 'Moved to play next');
    },
    async removePlayNext(id) {
      const item = this.queue.find((entry) => entry.id === id);
      if (item) item.playNext = false;
      return this.itemAction(id, 'remove-play-next', undefined, 'Removed from play next');
    },
    async skipItem(id) {
      return this.itemAction(id, 'skip', undefined, 'Skipped');
    }
  }
});
