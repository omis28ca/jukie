<script setup>
import { onMounted, ref, watch } from 'vue';
import SongCard from '../components/SongCard.vue';
import { useLibraryStore } from '../stores/library';
import { useUiStore } from '../stores/ui';
import { useYoutubeStore } from '../stores/youtube';

const library = useLibraryStore();
const ui = useUiStore();
const youtube = useYoutubeStore();

const tab = ref('local');
const searchTerm = ref(library.search);
let debounceTimer = null;

const ytUrl = ref('');
const ytFolder = ref('');
const ytMode = ref('audio');
const ytPlaylist = ref(false);

onMounted(() => {
  if (!library.loaded) library.fetch();
});

watch(tab, (value) => {
  if (value !== 'youtube') return;
  youtube.fetchStatus();
  youtube.fetchJobs();
});

watch(searchTerm, (value) => {
  library.setSearch(value);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => library.fetch(), 300);
});

function clearFilters() {
  searchTerm.value = '';
  library.search = '';
  library.genre = '';
  library.fetch();
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
  if (job.status === 'downloading') return `${Math.round(job.progressPercent || 0)}%`;
  if (job.status === 'completed') return 'Ready to import';
  if (job.status === 'cancelled') return 'Cancelled';
  return 'Failed';
}
</script>

<template>
  <div>
    <div class="tabs" role="tablist" aria-label="Library source">
      <button
        class="tab"
        role="tab"
        type="button"
        :aria-selected="tab === 'local'"
        :class="{ active: tab === 'local' }"
        @click="tab = 'local'"
      >
        Jukebox library
      </button>
      <button
        class="tab"
        role="tab"
        type="button"
        :aria-selected="tab === 'youtube'"
        :class="{ active: tab === 'youtube' }"
        @click="tab = 'youtube'"
      >
        YouTube download
      </button>
    </div>

    <!-- Local library -->
    <section v-show="tab === 'local'" class="section" role="tabpanel" aria-label="Jukebox library">
      <div class="search-bar panel">
        <div class="search-field">
          <label class="visually-hidden" for="lib-search">Search the library</label>
          <input
            id="lib-search"
            v-model="searchTerm"
            type="search"
            placeholder="Search by title, artist, album or genre…"
            autocomplete="off"
          />
        </div>
        <button class="btn" type="button" @click="clearFilters">Clear</button>
      </div>

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
          {{ library.search || library.genre ? 'Results' : 'All songs' }}
        </h2>
        <span class="sub">{{ library.songs.length }} songs</span>
      </div>

      <div v-if="library.loading && !library.songs.length" class="empty">Searching…</div>
      <div v-else-if="!library.songs.length" class="empty">
        No songs matched. Try a different search, or
        <RouterLink to="/upload">upload something</RouterLink>.
      </div>
      <div v-else class="card-grid">
        <SongCard v-for="song in library.songs" :key="song.id" :song="song" />
      </div>
    </section>

    <!-- yt-dlp download -->
    <section
      v-show="tab === 'youtube'"
      class="section"
      role="tabpanel"
      aria-label="YouTube download"
    >
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

      <form v-else class="panel stack yt-form" @submit.prevent="startDownload">
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
          <button
            class="btn btn-primary"
            type="submit"
            :disabled="youtube.starting || Boolean(youtube.activeJob)"
          >
            {{ youtube.starting ? 'Starting…' : 'Download' }}
          </button>
          <span v-if="youtube.status?.version" class="muted small">
            yt-dlp {{ youtube.status.version }} · max {{ youtube.status.maxFileMb }} MB per file
          </span>
        </div>
      </form>

      <ul v-if="youtube.jobs.length" class="yt-jobs panel">
        <li v-for="job in youtube.jobs" :key="job.id" class="yt-job">
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
            v-if="job.status === 'downloading'"
            class="btn btn-sm btn-danger"
            type="button"
            @click="youtube.cancel(job.id)"
          >
            Cancel
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 1.2rem;
  border-bottom: 1px solid var(--border);
}

.tab {
  padding: 0.55rem 0.9rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-dim);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.search-bar {
  display: flex;
  gap: 0.6rem;
  align-items: center;
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
