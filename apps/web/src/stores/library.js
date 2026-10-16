import { defineStore } from 'pinia';
import { api, apiUrl } from '../lib/api';
import { useUiStore } from './ui';

let searchController = null;

export const useLibraryStore = defineStore('library', {
  state: () => ({
    songs: [],
    search: '',
    genre: '',
    loading: false,
    loaded: false
  }),
  getters: {
    genres: (state) => {
      const set = new Set();
      for (const song of state.songs) {
        if (song?.genre) set.add(song.genre);
      }
      return [...set].sort((a, b) => a.localeCompare(b));
    },
    recentlyAdded: (state) =>
      [...state.songs]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 20),
    byId: (state) => (id) => state.songs.find((song) => song.id === id) || null
  },
  actions: {
    artworkUrl(song) {
      if (!song) return '';
      if (song.artworkUrl) return apiUrl(song.artworkUrl);
      return '';
    },
    mediaUrl(song) {
      if (!song) return '';
      return apiUrl(song.mediaUrl || `/api/songs/${encodeURIComponent(song.id)}/media`);
    },
    upsertSong(song) {
      if (!song?.id) return;
      const index = this.songs.findIndex((entry) => entry.id === song.id);
      if (index >= 0) this.songs.splice(index, 1, song);
      else this.songs.unshift(song);
    },
    setSearch(value) {
      this.search = value;
    },
    setGenre(value) {
      this.genre = this.genre === value ? '' : value;
      return this.fetch();
    },
    async fetch() {
      const ui = useUiStore();
      if (searchController) searchController.abort();
      searchController = new AbortController();
      this.loading = true;
      const params = new URLSearchParams();
      if (this.search.trim()) params.set('search', this.search.trim());
      if (this.genre) params.set('genre', this.genre);
      const qs = params.toString();
      try {
        const payload = await api.get(`/api/songs${qs ? `?${qs}` : ''}`, {
          signal: searchController.signal
        });
        this.songs = Array.isArray(payload?.songs) ? payload.songs : [];
        this.loaded = true;
      } catch (error) {
        if (error?.name === 'AbortError') return;
        ui.error(error);
      } finally {
        this.loading = false;
      }
    },
    async deleteSong(id) {
      const ui = useUiStore();
      try {
        await api.del(`/api/songs/${encodeURIComponent(id)}`);
        this.songs = this.songs.filter((song) => song.id !== id);
        ui.success('Song deleted');
      } catch (error) {
        ui.error(error);
        throw error;
      }
    }
  }
});
