import { defineStore } from 'pinia';
import { api } from '../lib/api';
import { useUiStore } from './ui';

export const useMoodsStore = defineStore('moods', {
  state: () => ({
    moods: [],
    loading: false,
    loaded: false,
    detail: null,
    detailLoading: false,
    activeMoodId: ''
  }),
  actions: {
    applyMoods(moods) {
      this.moods = Array.isArray(moods) ? moods : [];
      this.loaded = true;
    },
    async fetch() {
      this.loading = true;
      try {
        const payload = await api.get('/api/moods');
        this.applyMoods(payload?.moods ?? payload ?? []);
      } catch (error) {
        useUiStore().error(error);
      } finally {
        this.loading = false;
      }
    },
    async fetchOne(id) {
      this.detailLoading = true;
      try {
        this.detail = await api.get(`/api/moods/${encodeURIComponent(id)}`);
        return this.detail;
      } catch (error) {
        useUiStore().error(error);
        throw error;
      } finally {
        this.detailLoading = false;
      }
    },
    async create(name, songIds) {
      const ui = useUiStore();
      try {
        const payload = await api.post('/api/moods', songIds?.length ? { name, songIds } : { name });
        ui.success(`Mood “${name}” created`);
        await this.fetch();
        return payload;
      } catch (error) {
        ui.error(error);
        throw error;
      }
    },
    /** Save the recent playback history (or an explicit selection of it) as a new mood. */
    async createFromHistory(name, { songIds, limit } = {}) {
      const ui = useUiStore();
      try {
        const body = { name };
        if (songIds?.length) body.songIds = songIds;
        else if (limit) body.limit = limit;

        const payload = await api.post('/api/moods/from-history', body);
        const count = payload?.songs?.length ?? payload?.songCount ?? 0;
        ui.success(`Mood “${name}” saved with ${count} ${count === 1 ? 'track' : 'tracks'}`);
        await this.fetch();
        return payload;
      } catch (error) {
        ui.error(error);
        throw error;
      }
    },
    async rename(id, name) {
      const ui = useUiStore();
      try {
        const payload = await api.put(`/api/moods/${encodeURIComponent(id)}`, { name });
        ui.success('Mood renamed');
        await this.fetch();
        return payload;
      } catch (error) {
        ui.error(error);
        throw error;
      }
    },
    async remove(id) {
      const ui = useUiStore();
      try {
        await api.del(`/api/moods/${encodeURIComponent(id)}`);
        ui.success('Mood deleted');
        if (this.activeMoodId === id) this.activeMoodId = '';
        await this.fetch();
      } catch (error) {
        ui.error(error);
        throw error;
      }
    },
    async select(id) {
      const ui = useUiStore();
      try {
        await api.post(`/api/moods/${encodeURIComponent(id)}/select`);
        this.activeMoodId = id;
        const mood = this.moods.find((entry) => entry.id === id);
        ui.success(`Playing mood “${mood?.name || id}”`);
      } catch (error) {
        ui.error(error);
        throw error;
      }
    }
  }
});
