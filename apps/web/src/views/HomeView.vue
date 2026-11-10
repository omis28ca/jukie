<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ArtThumb from '../components/ArtThumb.vue';
import QueueItemRow from '../components/QueueItemRow.vue';
import HomeTools from '../components/HomeTools.vue';
import SongCard from '../components/SongCard.vue';
import { usePlayerStore } from '../stores/player';
import { useQueueStore } from '../stores/queue';
import { useLibraryStore } from '../stores/library';
import { useMoodsStore } from '../stores/moods';
import { useSessionStore } from '../stores/session';
import { useYoutubeStore } from '../stores/youtube';
import { useUiStore } from '../stores/ui';
import { formatTime } from '../lib/format';

const player = usePlayerStore();
const queue = useQueueStore();
const library = useLibraryStore();
const moods = useMoodsStore();
const session = useSessionStore();
const youtube = useYoutubeStore();
const ui = useUiStore();

const scrubbing = ref(false);
const scrubValue = ref(0);
const upNextSearch = ref('');
const searchSource = ref('youtube');
const shufflingQueue = ref(false);

const duration = computed(() => Number(player.nowPlaying?.duration) || 0);
const position = computed(() => (scrubbing.value ? scrubValue.value : player.positionSeconds));
const progressPct = computed(() => (duration.value > 0 ? (position.value / duration.value) * 100 : 0));

const upcoming = computed(() => queue.queue.filter((item) => item.status !== 'playing'));
const filteredUpcoming = computed(() => {
  const term = upNextSearch.value.trim().toLowerCase();
  if (!term) return upcoming.value;
  return upcoming.value.filter((item) => {
    const song = item.song || {};
    const haystack = [song.title, song.artist, song.album, item.requestedBy]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  });
});
const searchTerm = computed(() => upNextSearch.value.trim().toLowerCase());
const libraryResults = computed(() => {
  if (!searchTerm.value) return [];
  return library.songs.filter((song) =>
    [song.title, song.artist, song.album, song.genre]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(searchTerm.value)
  );
});
const nowItem = computed(() => queue.nowPlaying);

let youtubeSearchTimer;

onMounted(() => {
  if (!queue.loaded) queue.fetch();
  if (!moods.loaded) moods.fetch();
  if (!library.loaded) library.fetch();
  youtube.fetchJobs();
});

watch(upNextSearch, (value, previousValue) => {
  if (!previousValue.trim()) searchSource.value = 'youtube';
  clearTimeout(youtubeSearchTimer);
  youtube.clearSearch();
  const query = value.trim();
  if (query.length < 2) return;
  youtubeSearchTimer = setTimeout(() => youtube.search(query), 400);
});

onBeforeUnmount(() => {
  clearTimeout(youtubeSearchTimer);
  youtube.clearSearch();
});

function startScrub(event) {
  scrubbing.value = true;
  player.seeking = true;
  scrubValue.value = Number(event.target.value);
}

function onScrub(event) {
  scrubValue.value = Number(event.target.value);
}

function onVolume(event) {
  player.setVolume(Number(event.target.value)).catch(() => {
    /* toast already raised */
  });
}

function youtubeAction(result) {
  const job = youtube.songJobFor(result.videoId);
  if (job) return {
    disabled: true,
    label: job.status === 'queued' ? 'Waiting…' : `Downloading ${Math.round(job.progressPercent || 0)}%`
  };
  if (youtube.adding[result.videoId]) return { disabled: true, label: 'Adding…' };
  return {
    disabled: Boolean((result.isLive || result.tooLong) && !result.songId),
    label: 'Add'
  };
}

async function commitScrub() {
  if (!scrubbing.value) return;
  const value = scrubValue.value;
  scrubbing.value = false;
  player.seeking = false;
  try {
    await player.seek(value);
  } catch {
    /* toast already raised */
  }
}

async function shuffleQueue() {
  if (shufflingQueue.value) return;
  shufflingQueue.value = true;
  try {
    await queue.shuffle();
  } catch {
    /* toast already raised */
  } finally {
    shufflingQueue.value = false;
  }
}
</script>

<template>
  <div>
    <HomeTools />
    <!-- Now playing hero -->
    <section class="section">
      <div class="hero">
        <ArtThumb class="hero-art" :song="player.nowPlaying" />

        <div class="hero-body">
          <p class="hero-kicker">
            <span class="badge badge-accent">{{
              player.state === 'playing' ? 'Now playing' : player.state === 'paused' ? 'Paused' : 'Idle'
            }}</span>
            <span v-if="player.queueStopped" class="badge">Queue stopped</span>
            <span v-if="player.loopQueue" class="badge">Loop on</span>
          </p>

          <h2 class="hero-title">{{ player.nowPlaying?.title || 'Nothing is playing' }}</h2>
          <p class="hero-artist muted">
            {{ player.nowPlaying?.artist || (player.nowPlaying ? 'Unknown artist' : 'Queue a song to get the room going') }}
            <template v-if="player.nowPlaying?.album"> • {{ player.nowPlaying.album }}</template>
          </p>
          <p v-if="nowItem?.requestedBy" class="hero-req faint">
            Requested by {{ nowItem.requestedBy }}
          </p>

          <div class="hero-progress">
            <div class="hero-bar" aria-hidden="true">
              <div class="hero-bar-fill" :style="{ width: `${progressPct}%` }"></div>
            </div>
            <input
              class="hero-range"
              type="range"
              min="0"
              :max="duration || 1"
              step="1"
              :value="position"
              :disabled="!player.nowPlaying || duration <= 0"
              aria-label="Seek position"
              :aria-valuetext="`${formatTime(position)} of ${formatTime(duration)}`"
              @mousedown="startScrub"
              @touchstart="startScrub"
              @input="onScrub"
              @change="commitScrub"
              @mouseup="commitScrub"
              @touchend="commitScrub"
            />
            <div class="hero-times">
              <span>{{ formatTime(position) }}</span>
              <span>{{ formatTime(duration) }}</span>
            </div>
          </div>

          <div class="hero-actions">
            <button class="btn btn-primary" type="button" @click="player.toggle()">
              {{ player.state === 'playing' ? 'Pause' : 'Play' }}
            </button>
            <button class="btn" type="button" aria-label="Skip the current track" @click="player.skip()">
              Skip
            </button>
            <button
              class="btn"
              type="button"
              :aria-pressed="player.loopQueue"
              @click="player.toggleLoop()"
            >
              Loop {{ player.loopQueue ? 'on' : 'off' }}
            </button>
            <button
              v-if="player.queueStopped"
              class="btn"
              type="button"
              @click="player.start()"
            >
              Start queue
            </button>
            <button v-else class="btn" type="button" @click="player.stop()">Stop queue</button>
          </div>
          <div class="hero-volume">
            <label for="room-volume">Room volume — {{ player.volume }}%</label>
            <input id="room-volume" type="range" min="0" max="100" step="1"
              :value="player.volume" :aria-valuetext="`${player.volume} percent`" @input="onVolume" />
          </div>
        </div>
      </div>
    </section>

    <!-- Queue -->
    <section class="section">
      <div class="section-head">
        <h2>{{ searchTerm ? 'Search results' : 'Up next' }}</h2>
        <span class="sub">
          {{ filteredUpcoming.length }} in the queue
          <template v-if="upNextSearch.trim()"> (filtered from {{ upcoming.length }}) </template>
        </span>
        <button
          v-if="session.isAdmin"
          class="btn btn-sm"
          type="button"
          :disabled="shufflingQueue || upcoming.length < 2"
          @click="shuffleQueue"
        >
          {{ shufflingQueue ? 'Shuffling…' : 'Shuffle queue' }}
        </button>
      </div>
      <div class="upnext-tools">
        <label class="faint" for="upnext-search">Search queue, library, and YouTube</label>
        <input
          id="upnext-search"
          v-model="upNextSearch"
          type="search"
          placeholder="Search songs, artists, albums, or YouTube…"
          autocomplete="off"
        />
      </div>

      <div v-if="searchTerm" class="search-sources" role="group" aria-label="Search source">
        <button
          class="chip"
          type="button"
          :aria-pressed="searchSource === 'youtube'"
          @click="searchSource = 'youtube'"
        >
          YouTube<template v-if="youtube.searched"> ({{ youtube.results.length }})</template>
        </button>
        <button
          class="chip"
          type="button"
          :aria-pressed="searchSource === 'library'"
          @click="searchSource = 'library'"
        >
          Library ({{ libraryResults.length }})
        </button>
        <button
          class="chip"
          type="button"
          :aria-pressed="searchSource === 'queue'"
          @click="searchSource = 'queue'"
        >
          Queue ({{ filteredUpcoming.length }})
        </button>
      </div>

      <template v-if="!searchTerm || searchSource === 'queue'">
        <div v-if="queue.loading && !queue.loaded" class="empty">Loading the queue…</div>
        <div v-else-if="!upcoming.length && !searchTerm" class="empty">
          The queue is empty. Head to the
          <button class="inline-link" type="button" @click="ui.homePanel = 'library'">library</button> and add something.
        </div>
        <div v-else-if="!filteredUpcoming.length" class="empty">
          {{ searchTerm ? `No queue matches for “${upNextSearch.trim()}”.` : 'The queue is empty.' }}
        </div>
        <ul v-if="filteredUpcoming.length" class="qlist panel">
          <QueueItemRow
            v-for="(item, index) in filteredUpcoming"
            :key="item.id"
            :item="item"
            :index="index"
          />
        </ul>
      </template>

      <div v-if="searchTerm" class="search-results">
        <section v-if="searchSource === 'library'">
          <div class="section-head">
            <h3>Library</h3>
            <span class="sub">{{ libraryResults.length }} matches</span>
          </div>
          <div v-if="library.loading && !library.loaded" class="empty">Loading the library…</div>
          <div v-else-if="!libraryResults.length" class="empty">No library matches.</div>
          <div v-else class="card-grid">
            <SongCard
              v-for="song in libraryResults"
              :key="song.id"
              :song="song"
              compact
            />
          </div>
        </section>

        <section v-else-if="searchSource === 'youtube'">
          <div class="section-head">
            <h3>YouTube</h3>
            <span v-if="youtube.searched" class="sub">{{ youtube.results.length }} results</span>
          </div>
          <div v-if="youtube.searching && !youtube.results.length" class="empty">Searching YouTube…</div>
          <div v-else-if="youtube.searched && !youtube.results.length" class="empty">No YouTube matches.</div>
          <div v-else-if="!youtube.searched" class="empty">
            Enter at least 2 characters to search YouTube.
          </div>
          <div v-else class="youtube-results">
            <article v-for="result in youtube.results" :key="result.videoId" class="youtube-result">
              <img
                class="youtube-art"
                :src="result.thumbnailUrl"
                :alt="`Thumbnail for ${result.title}`"
                loading="lazy"
              />
              <div class="youtube-meta">
                <h3 class="truncate" :title="result.title">{{ result.title }}</h3>
                <p class="muted truncate">{{ result.channel || 'YouTube' }}</p>
                <p class="faint">
                  {{ result.isLive ? 'Live' : formatTime(result.duration) }}
                  <span v-if="result.songId"> · In library</span>
                  <span v-else-if="result.tooLong"> · Too long to add</span>
                </p>
              </div>
              <div class="youtube-actions">
                <button
                  class="btn btn-sm btn-primary"
                  type="button"
                  :disabled="youtubeAction(result).disabled"
                  @click="youtube.addSong(result)"
                >
                  {{ youtubeAction(result).label }}
                </button>
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="youtubeAction(result).disabled"
                  @click="youtube.addSong(result, { playNext: true })"
                >
                  Play next
                </button>
              </div>
              <p v-if="youtube.songJobFor(result.videoId)" class="muted" role="status">
                {{ youtubeAction(result).label }} — joins the queue when ready.
              </p>
            </article>
          </div>
        </section>
      </div>
    </section>

  </div>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: minmax(220px, 0.78fr) minmax(0, 1.22fr);
  gap: clamp(1.25rem, 3vw, 3rem);
  overflow: hidden;
  padding: clamp(1.25rem, 3vw, 2.5rem);
  border: 1px solid rgba(201, 243, 106, 0.15);
  border-radius: 24px;
  background:
    radial-gradient(ellipse at 2% 5%, rgba(201, 243, 106, 0.17), transparent 25rem),
    linear-gradient(125deg, #22251b 0%, #1b1d19 68%);
  box-shadow: var(--shadow);
}

.hero-art {
  width: 100%;
  max-width: 360px;
  height: auto;
  aspect-ratio: 1;
  border-radius: 18px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
}

.hero-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.hero-kicker {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
}

.hero-title {
  max-width: 780px;
  font-size: clamp(2rem, 4vw, 3.5rem);
  line-height: 1.02;
  letter-spacing: -0.055em;
  word-break: break-word;
}

.hero-artist {
  margin: 0.35rem 0 0;
}

.hero-req {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
}

.hero-progress {
  margin: 1.6rem 0 1.1rem;
  position: relative;
}

.hero-bar {
  height: 5px;
  border-radius: 4px;
  background: var(--surface-3);
  overflow: hidden;
}

.hero-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.4s linear;
  border-radius: inherit;
}

.hero-range {
  position: absolute;
  top: -7px;
  left: 0;
  width: 100%;
  opacity: 0;
  height: 18px;
}

.hero-range:focus-visible {
  opacity: 1;
}

.hero-times {
  display: flex;
  justify-content: space-between;
  font-size: 0.74rem;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  margin-top: 0.3rem;
}

.hero-actions {
  display: flex;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.hero-volume {
  display: grid;
  gap: 0.35rem;
  margin-top: 1rem;
  max-width: 360px;
}

.qlist {
  padding: 0.5rem;
}

.inline-link {
  padding: 0;
  color: var(--accent);
}

.inline-link:hover {
  text-decoration: underline;
}

.upnext-tools {
  display: grid;
  gap: 0.35rem;
  margin: 0.5rem 0 0.75rem;
}

.search-results {
  display: grid;
}

.search-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.youtube-results {
  display: grid;
  gap: 0.65rem;
}

.youtube-result {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.85rem;
  padding: 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.youtube-art {
  display: block;
  width: 120px;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-sm);
  object-fit: cover;
  background: var(--surface-3);
}

.youtube-meta {
  min-width: 0;
}

.youtube-meta h3 {
  font-size: 0.9rem;
}

.youtube-meta p {
  margin: 0.15rem 0 0;
  font-size: 0.76rem;
}

.youtube-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
}

@media (max-width: 860px) {
  .hero {
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 1rem;
    padding: 1.25rem;
  }

  .hero-art {
    max-width: none;
  }

  .hero-title {
    font-size: clamp(1.5rem, 4vw, 2.3rem);
  }

  .hero-range {
    opacity: 1;
  }
}

@media (max-width: 560px) {
  .youtube-result {
    grid-template-columns: 84px minmax(0, 1fr);
    gap: 0.65rem;
  }

  .youtube-art {
    width: 84px;
  }

  .youtube-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .hero {
    grid-template-columns: 1fr;
  }

  .hero-art {
    width: min(100%, 300px);
  }

  .hero-title {
    font-size: 2rem;
  }

  .hero-bar {
    display: none;
  }
}
</style>
