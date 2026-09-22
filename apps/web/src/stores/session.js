import { defineStore } from 'pinia';
import { api } from '../lib/api';

const NAME_KEY = 'jukie.name';
const PIN_KEY = 'jukie.pin';

function read(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode) — session-only identity */
  }
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    name: read(NAME_KEY),
    pin: read(PIN_KEY),
    isAdmin: false,
    info: null,
    validating: false
  }),
  getters: {
    hasJoined: (state) => Boolean(state.name && state.name.trim())
  },
  actions: {
    setName(name) {
      const clean = String(name || '').trim().slice(0, 60);
      this.name = clean;
      write(NAME_KEY, clean);
    },
    clearName() {
      this.name = '';
      write(NAME_KEY, '');
    },
    async loadInfo() {
      try {
        this.info = await api.get('/api/info');
      } catch {
        this.info = null;
      }
      return this.info;
    },
    joinUrl() {
      return this.info?.joinUrl || window.location.origin;
    },
    /** Validate a PIN against the server before persisting it. */
    async validatePin(pin) {
      const clean = String(pin || '').trim();
      this.validating = true;
      try {
        await api.post('/api/admin/auth', { pin: clean });
        this.pin = clean;
        this.isAdmin = true;
        write(PIN_KEY, clean);
        return true;
      } finally {
        this.validating = false;
      }
    },
    /** Re-check a PIN restored from localStorage on boot. */
    async restoreAdmin() {
      if (!this.pin) return false;
      try {
        await api.post('/api/admin/auth', { pin: this.pin });
        this.isAdmin = true;
        return true;
      } catch {
        this.isAdmin = false;
        this.pin = '';
        write(PIN_KEY, '');
        return false;
      }
    },
    signOutAdmin() {
      this.pin = '';
      this.isAdmin = false;
      write(PIN_KEY, '');
    }
  }
});
