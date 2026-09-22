import { defineStore } from 'pinia';
import { api } from '../lib/api';
import { useUiStore } from './ui';

const FINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

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
    starting: false
  }),
  getters: {
    available: (state) => Boolean(state.status?.available),
    activeJob: (state) => state.jobs.find((job) => job.status === 'downloading') ?? null
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
