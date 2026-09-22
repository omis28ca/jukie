import { defineStore } from 'pinia';
import { api } from '../lib/api';
import { useUiStore } from './ui';

const EMPTY_OUTPUT = { deviceId: null, applied: false, message: '', lastAttemptAt: null };

let ticker = null;

export const usePlayerStore = defineStore('player', {
  state: () => ({
    state: 'idle',
    volume: 80,
    nowPlaying: null,
    positionSeconds: 0,
    loopQueue: false,
    queueStopped: false,
    audioOutput: { ...EMPTY_OUTPUT },
    loaded: false,
    seeking: false,
    lastServerAt: 0
  }),
  getters: {
    isPlaying: (state) => state.state === 'playing',
    isPaused: (state) => state.state === 'paused',
    isIdle: (state) => state.state === 'idle',
    duration: (state) => Number(state.nowPlaying?.duration) || 0,
    progressRatio(state) {
      const total = Number(state.nowPlaying?.duration) || 0;
      if (total <= 0) return 0;
      return Math.min(1, Math.max(0, state.positionSeconds / total));
    }
  },
  actions: {
    applyServerState(payload) {
      if (!payload || typeof payload !== 'object') return;
      this.state = payload.state ?? this.state;
      if (typeof payload.volume === 'number') this.volume = payload.volume;
      if ('nowPlaying' in payload) this.nowPlaying = payload.nowPlaying ?? null;
      if (typeof payload.positionSeconds === 'number' && !this.seeking) {
        // Reset the local interpolation each time the server speaks.
        this.positionSeconds = payload.positionSeconds;
      }
      if (typeof payload.loopQueue === 'boolean') this.loopQueue = payload.loopQueue;
      if (typeof payload.queueStopped === 'boolean') this.queueStopped = payload.queueStopped;
      this.audioOutput = { ...EMPTY_OUTPUT, ...(payload.audioOutput || {}) };
      this.loaded = true;
      this.lastServerAt = Date.now();
    },
    applyNowPlaying(song) {
      this.nowPlaying = song ?? null;
      this.positionSeconds = 0;
    },
    startTicker() {
      if (ticker) return;
      ticker = setInterval(() => {
        if (this.state !== 'playing' || this.seeking) return;
        const total = Number(this.nowPlaying?.duration) || 0;
        const next = this.positionSeconds + 1;
        this.positionSeconds = total > 0 ? Math.min(next, total) : next;
      }, 1000);
    },
    stopTicker() {
      if (!ticker) return;
      clearInterval(ticker);
      ticker = null;
    },
    async fetch() {
      try {
        const state = await api.get('/api/player');
        this.applyServerState(state);
      } catch (error) {
        useUiStore().error(error);
      }
    },
    async command(action, body) {
      const ui = useUiStore();
      try {
        const result = await api.post(`/api/player/${action}`, body);
        if (result && typeof result === 'object' && 'state' in result) {
          this.applyServerState(result);
        }
        return result;
      } catch (error) {
        ui.error(error);
        await this.fetch();
        throw error;
      }
    },
    async play() {
      if (this.state === 'paused') {
        this.state = 'playing';
        await this.command('resume');
        return;
      }
      this.state = 'playing';
      await this.command('start');
    },
    async pause() {
      this.state = 'paused';
      await this.command('pause');
    },
    async resume() {
      this.state = 'playing';
      await this.command('resume');
    },
    async toggle() {
      if (this.state === 'playing') await this.pause();
      else await this.play();
    },
    async stop() {
      this.state = 'idle';
      this.positionSeconds = 0;
      await this.command('stop');
    },
    async start() {
      await this.command('start');
    },
    async skip() {
      this.positionSeconds = 0;
      await this.command('skip');
    },
    async seek(positionSeconds) {
      const value = Math.max(0, Math.round(Number(positionSeconds) || 0));
      this.positionSeconds = value;
      await this.command('seek', { positionSeconds: value });
    },
    async setVolume(volume) {
      const value = Math.min(100, Math.max(0, Math.round(Number(volume) || 0)));
      this.volume = value;
      await this.command('volume', { volume: value });
    },
    async setLoop(enabled) {
      this.loopQueue = Boolean(enabled);
      await this.command('loop', { enabled: Boolean(enabled) });
    },
    async toggleLoop() {
      await this.setLoop(!this.loopQueue);
    }
  }
});
