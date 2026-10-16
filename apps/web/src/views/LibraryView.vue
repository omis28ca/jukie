<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import SongCard from '../components/SongCard.vue';
import { useLibraryStore } from '../stores/library';
import { useUiStore } from '../stores/ui';
import { useYoutubeStore } from '../stores/youtube';
import { formatTime } from '../lib/format';

const library = useLibraryStore();
const ui = useUiStore();
const youtube = useYoutubeStore();

const searchTerm = ref(library.search);
let debounceTimer = null;

const ytUrl = ref('');
const ytFolder = ref('');
const ytMode = ref('audio');
const ytPlaylist = ref(false);

const trimmedTerm = computed(() => searchTerm.value.trim());
const showYoutubePrompt = computed(
  () =>
    trimmedTerm.value.length >= 2 &&
    trimmedTerm.value !== youtube.searchQuery &&
    // Offer it while the availability check is still running; hide only once yt-dlp is known missing.
    youtube.status?.available !== false
);
const showYoutubeResults = computed(() => youtube.searching || youtube.searched);

onMounted(() => {
  if (!library.loaded) library.fetch();
  youtube.fetchStatus();
  youtube.fetchJobs();
});

watch(searchTerm, (value) => {
  library.setSearch(value);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => library.fetch(), 300);
});

function searchYoutube() {
  if (trimmedTerm.value.length < 2) {
    ui.error('Type at least 2 characters to search YouTube');
    return;
  }
  youtube.search(trimmedTerm.value);
}

function clearFilters() {
  searchTerm.value = '';
  library.search = '';
  library.genre = '';
  library.fetch();
  youtube.clearSearch();
}

function resultAction(result) {
  const job = youtube.songJobFor(result.videoId);
  if (job) {
    return {
      label: job.status === 'queued' ? 'Waiting…' : `${Math.round(job.progressPercent || 0)}%`,
      disabled: true,
      job
    };
  }
  if (youtube.adding[result.videoId]) return { label: 'Adding…', disabled: true };
  if (result.isLive) return { label: 'Live', disabled: true };
  if (result.tooLong) return { label: 'Too long', disabled: true };
  return { label: 'Add', disabled: false };
}

async function startDownload() {
  const url = ytUrl.value.trim();
  if (!url) {
    ui.error('Paste a YouTube link first');
    return;
  }
  try {
    await youtube.download({
      url,
      folderName: ytFolder.value.trim(),
      mode: ytMode.value,
      playlist: ytPlaylist.value
    });
    ytUrl.value = '';
  } catch {
    /* toast already raised */
  }
}

function jobStatusLabel(job) {
  if (job.status === 'queued') return 'Waiting';
  if (job.status === 'downloading') return `${Math.round(job.progressPercent || 0)}%`;
  if (job.status === 'completed') return 'Ready to import';
  if (job.status === 'cancelled') return 'Cancelled';
  return 'Failed';
}
</script>

<template>
  <div>
    <form class="search-bar panel" role="search" @submit.prevent="searchYoutube">
      <div class="search-field">
        <label class="visually-hidden" for="lib-search">Search the library or YouTube</label>
        <input
          id="lib-search"
          v-model="searchTerm"
          type="search"
          enterkeyhint="search"
          placeholder="Search songs, artists, or YouTube…"
          autocomplete="off"
        />
      </div>
      <button class="btn" type="button" @click="clearFilters">Clear</button>
    </form>

    <button v-if="showYoutubePrompt" class="yt-prompt" type="button" @click="searchYoutube">
      <span class="yt-logo" aria-hidden="true">▶</span>
      <span class="min truncate">
        Search YouTube for <strong>“{{ trimmedTerm }}”</strong>
      </span>
    </button>

    <!-- YouTube results -->
    <section v-if="showYoutubeResults" class="section" aria-label="YouTube results">
      <div class="section-head">
        <h2>From YouTube</h2>
        <button class="btn btn-sm btn-ghost" type="button" @click="youtube.clearSearch()">Hide</button>
      </div>

      <div v-if="youtube.searching" class="empty">Searching YouTube for “{{ youtube.searchQuery }}”…</div>
      <div v-else-if="!youtube.results.length" class="empty">
        No YouTube results for “{{ youtube.searchQuery }}”.
      </div>
      <ul v-else class="yt-results panel">
        <li v-for="result in youtube.results" :key="result.videoId" class="yt-result">
          <img class="yt-thumb" :src="result.thumbnailUrl" alt="" loading="lazy" />
          <div class="yt-meta min">
            <span class="yt-title yt-clamp" :title="result.title">{{ result.title }}</span>
            <span class="muted small truncate">
              {{ result.channel || 'YouTube' }}
              <template v-if="result.duration"> • {{ formatTime(result.duration) }}</template>
              <template v-if="result.songId"> • in library</template>
            </span>
            <div
              v-if="resultAction(result).job?.status === 'downloading'"
              class="yt-bar"
              role="progressbar"
              :aria-valuenow="Math.round(resultAction(result).job.progressPercent || 0)"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span :style="{ width: `${Math.max(2, resultAction(result).job.progressPercent || 0)}%` }"></span>
            </div>
          </div>
          <button
            class="btn btn-sm"
            :class="{ 'btn-primary': !resultAction(result).disabled }"
            type="button"
            :disabled="resultAction(result).disabled"
            :aria-label="`Add ${result.title} to the queue`"
            @click="youtube.addSong(result)"
          >
            {{ resultAction(result).label }}
          </button>
        </li>
      </ul>
      <p v-if="youtube.results.length" class="muted small yt-hint">
        Songs not in the library are downloaded with yt-dlp, saved to the library, then queued.
      </p>
    </section>

    <!-- Local library -->
    <section class="section" aria-label="Jukebox library">
      <div v-if="library.genres.length" class="genre-chips" role="group" aria-label="Filter by genre">
        <button
          v-for="genre in library.genres"
          :key="genre"
          class="chip"
          type="button"
          :aria-pressed="library.genre === genre"
          :class="{ active: library.genre === genre }"
          @click="library.setGenre(genre)"
        >
          {{ genre }}
        </button>
      </div>

      <div class="section-head">
        <h2>
          {{ library.search || library.genre ? 'In the library' : 'All songs' }}
        </h2>
        <span class="sub">{{ library.songs.length }} songs</span>
      </div>

      <div v-if="library.loading && !library.songs.length" class="empty">Searching…</div>
      <div v-else-if="!library.songs.length" class="empty">
        No songs in the library matched.
        <template v-if="youtube.status?.available !== false"> Try searching YouTube above, or </template>
        <template v-else> Try a different search, or </template>
        <RouterLink to="/upload">upload something</RouterLink>.
      </div>
      <div v-else class="card-grid">
        <SongCard v-for="song in library.songs" :key="song.id" :song="song" />
      </div>
    </section>

    <!-- yt-dlp link → mood -->
    <details class="section panel yt-advanced">
      <summary>Download a YouTube link or playlist as a mood</summary>

      <p class="notice">
        Downloads run through <strong>yt-dlp</strong> and land in the folder-import inbox, where Jukie
        turns them into a mood. Only download material you have the right to use — respect YouTube's
        terms and the rights of the people who made it.
      </p>

      <div v-if="youtube.status && !youtube.available" class="empty">
        yt-dlp is not available on the server.
        <span v-if="youtube.status.error" class="muted small"> ({{ youtube.status.error }})</span>
        <br />
        Install it and set <code>YTDLP_EXEC</code> if it is not on the server's PATH.
      </div>

      <form v-else class="stack yt-form" @submit.prevent="startDownload">
        <div>
          <label for="yt-url">YouTube link</label>
          <input
            id="yt-url"
            v-model="ytUrl"
            type="url"
            inputmode="url"
            autocomplete="off"
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </div>

        <div>
          <label for="yt-folder">Mood name (optional)</label>
          <input
            id="yt-folder"
            v-model="ytFolder"
            type="text"
            maxlength="80"
            placeholder="Defaults to the video or playlist title"
          />
          <p class="muted small">
            The download becomes a folder in the import inbox, and the importer creates a mood with
            that name. An existing mood with the same name is replaced.
          </p>
        </div>

        <div class="yt-options">
          <label class="yt-check">
            <input v-model="ytMode" type="radio" value="audio" />
            <span>Audio only (m4a)</span>
          </label>
          <label class="yt-check">
            <input v-model="ytMode" type="radio" value="video" />
            <span>Full video (mp4)</span>
          </label>
          <label class="yt-check">
            <input v-model="ytPlaylist" type="checkbox" />
            <span>Download the whole playlist</span>
          </label>
        </div>

        <div class="row">
          <button class="btn btn-primary" type="submit" :disabled="youtube.starting">
            {{ youtube.starting ? 'Starting…' : 'Download' }}
          </button>
          <span v-if="youtube.status?.version" class="muted small">
            yt-dlp {{ youtube.status.version }} · max {{ youtube.status.maxFileMb }} MB per file
          </span>
        </div>
      </form>

      <ul v-if="youtube.folderJobs.length" class="yt-jobs">
        <li v-for="job in youtube.folderJobs" :key="job.id" class="yt-job">
          <div class="min">
            <span class="yt-title truncate">{{ job.title || job.url }}</span>
            <span class="muted small truncate">{{ job.message }}</span>
            <div v-if="job.status === 'downloading'" class="yt-bar" role="progressbar">
              <span :style="{ width: `${Math.max(2, job.progressPercent || 0)}%` }"></span>
            </div>
          </div>
          <span class="badge" :class="{ 'badge-accent': job.status === 'completed' }">
            {{ jobStatusLabel(job) }}
          </span>
          <button
            v-if="job.status === 'downloading' || job.status === 'queued'"
            class="btn btn-sm btn-danger"
            type="button"
            @click="youtube.cancel(job.id)"
          >
            Cancel
          </button>
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 1rem;
}

.yt-prompt {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  margin: -0.4rem 0 1rem;
  padding: 0.75rem 0.9rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-dim);
  font: inherit;
  font-size: 0.9rem;
  text-align: left;
  cursor: pointer;
}

.yt-prompt:hover {
  color: var(--text);
  border-color: var(--accent);
}

.yt-prompt strong {
  color: var(--text);
}

.yt-logo {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 22px;
  border-radius: 6px;
  background: #e5332a;
  color: #fff;
  font-size: 0.7rem;
}

.yt-results {
  padding: 0.4rem;
}

.yt-result {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
}

.yt-result + .yt-result {
  margin-top: 0.2rem;
}

.yt-result:hover {
  background: var(--surface-2);
}

.yt-thumb {
  flex: none;
  width: 88px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  background: var(--surface-3);
}

.yt-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.yt-hint {
  margin: 0.5rem 0 0;
}

.yt-advanced {
  padding: 0.9rem 1rem;
}

.yt-advanced summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.92rem;
}

.yt-advanced[open] summary {
  margin-bottom: 1rem;
}

.yt-form {
  margin-bottom: 1rem;
}

.yt-options {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.yt-check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font-size: 0.88rem;
}

.yt-check input {
  accent-color: var(--accent);
}

.yt-jobs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.yt-job {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.yt-title {
  display: block;
  font-weight: 600;
  font-size: 0.9rem;
}

.yt-bar {
  margin-top: 0.35rem;
  height: 5px;
  border-radius: 999px;
  background: var(--border);
  overflow: hidden;
}

.yt-bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

.min {
  min-width: 0;
  flex: 1;
}

.yt-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.3;
}

.search-field {
  flex: 1;
  min-width: 0;
}

.genre-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1.2rem;
}

.notice {
  font-size: 0.8rem;
  color: var(--text-dim);
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--warn);
  border-radius: var(--radius-sm);
  padding: 0.6rem 0.8rem;
  margin-bottom: 1rem;
}
</style>
