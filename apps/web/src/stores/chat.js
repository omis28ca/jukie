import { defineStore } from 'pinia';
import { api } from '../lib/api';
import { useUiStore } from './ui';

const MAX_MESSAGES = 100;

/**
 * Room chat. Everything is pushed over Socket.IO (`chat:snapshot`, `chat:message`, `chat:presence`,
 * `chat:cleared`); the REST calls are only used for the first paint and for sending.
 */
export const useChatStore = defineStore('chat', {
  state: () => ({
    messages: [],
    presence: [],
    loaded: false,
    live: false,
    loading: false,
    sending: false
  }),
  getters: {
    onlineCount: (state) => state.presence.length
  },
  actions: {
    async fetch() {
      this.loading = true;
      try {
        const payload = await api.get('/api/chat');
        this.applySnapshot(payload);
      } catch {
        /* the socket snapshot usually wins the race anyway */
      } finally {
        this.loading = false;
      }
    },
    /**
     * `live` marks snapshots pushed by the socket. A REST response that lands after one of those is
     * older than what we already have, so it is dropped instead of rewinding the board.
     */
    applySnapshot(payload, live = false) {
      if (this.live && !live) return;
      if (live) this.live = true;
      if (Array.isArray(payload?.messages)) this.messages = payload.messages.slice(-MAX_MESSAGES);
      if (Array.isArray(payload?.presence)) this.presence = payload.presence;
      this.loaded = true;
    },
    applyMessage(message) {
      if (!message?.id || this.messages.some((entry) => entry.id === message.id)) return;
      this.messages = [...this.messages, message].slice(-MAX_MESSAGES);
    },
    applyPresence(payload) {
      if (Array.isArray(payload?.presence)) this.presence = payload.presence;
    },
    clearLocal() {
      this.messages = [];
    },
    async send(body) {
      const text = String(body ?? '').trim();
      if (!text) return null;
      const ui = useUiStore();
      this.sending = true;
      try {
        const payload = await api.post('/api/chat', { body: text });
        if (payload?.message) this.applyMessage(payload.message);
        return payload?.message ?? null;
      } catch (error) {
        ui.error(error);
        throw error;
      } finally {
        this.sending = false;
      }
    },
    async clear() {
      const ui = useUiStore();
      try {
        await api.del('/api/chat');
        this.clearLocal();
      } catch (error) {
        ui.error(error);
      }
    }
  }
});
