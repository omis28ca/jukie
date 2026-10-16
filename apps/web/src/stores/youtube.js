import { defineStore } from 'pinia';
import { api } from '../lib/api';
import { useUiStore } from './ui';

const FINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_STATUSES = new Set(['queued', 'downloading']);

// Song jobs this browser started, so only the person who clicked gets the "added" toast.
const mySongJobs = new Set();

function isStaleJob(current, next) {
  if (FINAL_STATUSES.has(current.status) && !FINAL_STATUSES.has(next.status)) return true;
  const currentAt = Date.parse(current.updatedAt ?? '');
  const nextAt = Date.parse(next.updatedAt ?? '');
  return Number.isFinite(currentAt) && Number.isFinite(nextAt) && nextAt < currentAt;
}

/**
 * Tracks yt-dlp downloads. Jobs are server-side and broadcast over Socket.IO (`ytdlp:job`), so a
 * download keeps updating even if the page is reopened mid-way.
 */
export const useYoutubeStore = defineStore('youtube', {
  state: () => ({
    status: null,
    statusLoading: false,
    jobs: [],
    starting: false,
    searchQuery: '',
    results: [],
    searching: false,
    searched: false,
    adding: {}
  }),
  getters: {
    available: (state) => Boolean(state.status?.available),
    activeJob: (state) => state.jobs.find((job) => job.status === 'downloading') ?? null,
    folderJobs: (state) => state.jobs.filter((job) => job.kind !== 'song'),
    /** The live (queued or downloading) song job for a video, if any. */
    songJobFor: (state) => (videoId) =>
      state.jobs.find((job) => job.kind === 'song' && job.videoId === videoId && ACTIVE_STATUSES.has(job.status)) ??
      null
  },
  actions: {
    async fetchStatus() {
      this.statusLoading = true;
      try {
        this.status = await api.get('/api/external/youtube');
      } catch {
        this.status = { available: false, error: 'The server did not answer' };
      } finally {
        this.statusLoading = false;
      }
    },
    async fetchJobs() {
      try {
        const payload = await api.get('/api/external/youtube/jobs');
        this.jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
      } catch {
        /* keep whatever we already have */
      }
    },
    applyJob(job) {
      if (!job?.id) return;
      const index = this.jobs.findIndex((entry) => entry.id === job.id);
      if (index === -1) {
        this.jobs = [job, ...this.jobs].slice(0, 20);
        return;
      }
      // Socket updates can overtake the HTTP response that started or cancelled the job, so never
      // let an older snapshot overwrite a newer one.
      const current = this.jobs[index];
      if (isStaleJob(current, job)) return;
      this.jobs.splice(index, 1, job);
      if (job.kind === 'song' && FINAL_STATUSES.has(job.status)) this.finishSongJob(job);
    },
    finishSongJob(job) {
      if (job.status === 'completed' && job.songId) {
        const result = this.results.find((entry) => entry.videoId === job.videoId);
        if (result) result.songId = job.songId;
      }
      if (!mySongJobs.delete(job.id)) return;
      const ui = useUiStore();
      if (job.status === 'completed') ui.success(`Added “${job.title || 'song'}” to the queue`);
      else if (job.status === 'failed') ui.error(job.error || 'The YouTube download failed');
    },
    async search(query) {
      const ui = useUiStore();
      const q = String(query ?? '').trim();
      if (q.length < 2) {
        this.clearSearch();
        return;
      }
      this.searchQuery = q;
      this.searching = true;
      try {
        const payload = await api.get(`/api/external/youtube/search?q=${encodeURIComponent(q)}`);
        // A newer search may have started while this one ran; keep only the latest.
        if (this.searchQuery !== q) return;
        this.results = Array.isArray(payload?.results) ? payload.results : [];
        this.searched = true;
      } catch (error) {
        if (this.searchQuery === q) ui.error(error);
      } finally {
        if (this.searchQuery === q) this.searching = false;
      }
    },
    clearSearch() {
      this.searchQuery = '';
      this.results = [];
      this.searched = false;
      this.searching = false;
    },
    /** Queues a result; songs not yet in the library are downloaded first, then queued. */
    async addSong(result, { playNext = false } = {}) {
      const ui = useUiStore();
      this.adding = { ...this.adding, [result.videoId]: true };
      try {
        const payload = await api.post('/api/external/youtube/songs', {
          videoId: result.videoId,
          title: result.title,
          channel: result.channel || undefined,
          playNext
        });
        if (payload?.item) {
          ui.success(`Added “${payload.song?.title || result.title}” to the queue`);
        } else if (payload?.job) {
          mySongJobs.add(payload.job.id);
          this.applyJob(payload.job);
          ui.info(
            payload.job.status === 'queued'
              ? 'Waiting for another download — it joins the queue when ready'
              : 'Downloading — it joins the queue when ready'
          );
        }
      } catch (error) {
        ui.error(error);
      } finally {
        const { [result.videoId]: _done, ...rest } = this.adding;
        this.adding = rest;
      }
    },
    async download({ url, folderName, mode = 'audio', playlist = false }) {
      const ui = useUiStore();
      this.starting = true;
      try {
        const payload = await api.post('/api/external/youtube/download', {
          url,
          folderName: folderName || undefined,
          mode,
          playlist
        });
        if (payload?.job) this.applyJob(payload.job);
        ui.info('Download started — it lands in the import folder when it finishes');
        return payload?.job ?? null;
      } catch (error) {
        ui.error(error);
        throw error;
      } finally {
        this.starting = false;
      }
    },
    async cancel(jobId) {
      const ui = useUiStore();
      try {
        const payload = await api.del(`/api/external/youtube/jobs/${jobId}`);
        if (payload?.job) this.applyJob(payload.job);
      } catch (error) {
        ui.error(error);
      }
    }
  }
});
