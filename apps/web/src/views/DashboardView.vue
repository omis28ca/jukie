<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AdminPanel from "../components/AdminPanel.vue";
import PlayerDock from "../components/PlayerDock.vue";
import UploadPanel from "../components/UploadPanel.vue";
import { useJukeboxStore } from "../stores/jukebox";
import { formatDuration, getSongArtworkUrl, getSongCoverStyle, getSongInitials } from "../utils/media";

const store = useJukeboxStore();
const route = useRoute();
const router = useRouter();
const query = ref("");
const searchInput = ref(null);
const genre = ref("all");
const sortBy = ref("recent");
const artworkOnly = ref(false);
const queueOpen = ref(false);
const mobileNavOpen = ref(false);
const activePanel = ref(null);
const requestedBy = ref(localStorage.getItem("jukebox-requester-name") || "");
const failedArtwork = ref(new Set());
const waveformCache = new Map();

const genres = computed(() => [...new Set(store.songs.map((song) => song.genre).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b)));

const filteredSongs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  const songs = store.songs.filter((song) => {
    const searchable = [song.title, song.artist, song.album, song.genre].filter(Boolean).join(" ").toLowerCase();
    const matchesQuery = !needle || searchable.includes(needle);
    const matchesGenre = genre.value === "all" || song.genre === genre.value;
    const matchesArtwork = !artworkOnly.value || Boolean(getSongArtworkUrl(song));
    return matchesQuery && matchesGenre && matchesArtwork;
  });

  if (sortBy.value === "title") return [...songs].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  if (sortBy.value === "artist") return [...songs].sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
  if (sortBy.value === "duration") return [...songs].sort((a, b) => Number(b.duration || 0) - Number(a.duration || 0));
  return songs;
});

const featuredSongs = computed(() => store.songs.slice(0, 4));
const heroSong = computed(() => store.player.nowPlaying || store.songs[0] || null);
const queuedSongCounts = computed(() => store.queuedItems.reduce((counts, item) => {
  counts[item.song.id] = (counts[item.song.id] || 0) + 1;
  return counts;
}, {}));

watch(requestedBy, (value) => localStorage.setItem("jukebox-requester-name", value));
watch(
  () => route.path,
  (path) => {
    activePanel.value = path === "/upload" ? "upload" : path === "/admin" ? "admin" : null;
  },
  { immediate: true }
);

function artworkUrl(song) {
  if (!song || failedArtwork.value.has(song.id)) return "";
  return getSongArtworkUrl(song);
}

function markArtworkFailed(song) {
  const next = new Set(failedArtwork.value);
  next.add(song.id);
  failedArtwork.value = next;
}

function getWaveBars(song) {
  const key = song?.id || "empty";
  if (waveformCache.has(key)) return waveformCache.get(key);
  let seed = [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const bars = Array.from({ length: 34 }, (_, index) => {
    seed = (seed * 9301 + 49297 + index) % 233280;
    return 18 + Math.round((seed / 233280) * 76);
  });
  waveformCache.set(key, bars);
  return bars;
}

function addToQueue(song) {
  store.addToQueue(song.id, requestedBy.value);
}

function removeSong(song) {
  if (!window.confirm(`Permanently delete “${song.title}” from the library?`)) return;
  store.deleteSong(song.id);
}

function openPanel(panel) {
  mobileNavOpen.value = false;
  router.push(panel === "upload" ? "/upload" : "/admin");
}

function closePanel() {
  activePanel.value = null;
  if (route.path === "/upload" || route.path === "/admin") router.push("/");
}

function scrollToCatalog() {
  document.querySelector("#catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.value?.focus();
    return;
  }

  if (event.key === "Escape") {
    if (activePanel.value) closePanel();
    queueOpen.value = false;
    mobileNavOpen.value = false;
  }
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <div class="music-app">
    <aside class="sidebar" :class="{ 'is-open': mobileNavOpen }">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>VibeBox</span>
      </div>

      <nav class="side-nav" aria-label="Primary navigation">
        <span class="nav-label">Discover</span>
        <RouterLink to="/library" class="side-nav-item" :class="{ 'is-active': route.path === '/' }" @click="mobileNavOpen = false">
          <span class="nav-icon" aria-hidden="true">♫</span>
          <span>Music library</span>
        </RouterLink>
        <button class="side-nav-item" type="button" @click="queueOpen = true; mobileNavOpen = false">
          <span class="nav-icon" aria-hidden="true">☷</span>
          <span>Up next</span>
          <b v-if="store.queuedItems.length" class="nav-count">{{ store.queuedItems.length }}</b>
        </button>

        <span class="nav-label">Contribute</span>
        <button class="side-nav-item" type="button" @click="openPanel('upload')">
          <span class="nav-icon" aria-hidden="true">↑</span>
          <span>Upload music</span>
        </button>

        <span class="nav-label">Manage</span>
        <button class="side-nav-item" type="button" @click="openPanel('admin')">
          <span class="nav-icon" aria-hidden="true">⌁</span>
          <span>Studio controls</span>
        </button>
      </nav>

      <div class="sidebar-session">
        <span class="connection-dot" :class="{ 'is-online': store.socketConnected }"></span>
        <div>
          <strong>{{ store.socketConnected ? "Live session" : "Reconnecting" }}</strong>
          <span>{{ store.socketConnected ? "Room is in sync" : "Updates paused" }}</span>
        </div>
      </div>
    </aside>

    <div v-if="mobileNavOpen" class="nav-backdrop" @click="mobileNavOpen = false"></div>

    <div class="workspace">
      <header class="topbar">
        <button class="mobile-menu" type="button" aria-label="Open navigation" @click="mobileNavOpen = true">☰</button>
        <label class="search-box">
          <span aria-hidden="true">⌕</span>
          <input ref="searchInput" v-model="query" type="search" placeholder="Search tracks, artists, albums…" aria-label="Search music library" />
          <kbd>Ctrl K</kbd>
        </label>
        <div class="topbar-actions">
          <button class="button button-secondary top-upload" type="button" @click="openPanel('upload')">
            <span aria-hidden="true">＋</span> Upload track
          </button>
          <button class="profile-button" type="button" aria-label="Open studio controls" @click="openPanel('admin')">
            <span aria-hidden="true">●</span>
          </button>
        </div>
      </header>

      <main class="catalog-main">
        <section class="feature-strip" aria-label="Featured music">
          <article class="hero-card">
            <div class="hero-copy">
              <span class="eyebrow">Shared office jukebox</span>
              <h1>Give the room<br />a better soundtrack.</h1>
              <p>Pick a track, add your name, and join the live queue.</p>
              <div class="hero-actions">
                <button class="button button-light" type="button" @click="scrollToCatalog">Explore library</button>
                <button v-if="heroSong" class="button button-glass" type="button" :disabled="store.loading.queueAdd" @click="addToQueue(heroSong)">
                  + Queue latest
                </button>
              </div>
            </div>
            <div class="hero-art" aria-hidden="true">
              <span class="hero-disc"></span>
              <span class="hero-wave hero-wave-one"></span>
              <span class="hero-wave hero-wave-two"></span>
            </div>
          </article>

          <article v-for="(song, index) in featuredSongs" :key="song.id" class="feature-card">
            <div class="feature-art media-cover" :style="getSongCoverStyle(song)">
              <img v-if="artworkUrl(song)" :src="artworkUrl(song)" alt="" @error="markArtworkFailed(song)" />
              <span v-else>{{ getSongInitials(song) }}</span>
            </div>
            <div class="feature-shade"></div>
            <span class="feature-label">{{ index === 0 ? "New in" : index === 1 ? "Team pick" : "Collection" }}</span>
            <div class="feature-copy">
              <strong>{{ song.title }}</strong>
              <span>{{ song.artist || song.genre || "Fresh upload" }}</span>
            </div>
            <button class="feature-add" type="button" :disabled="store.loading.queueAdd" :aria-label="`Add ${song.title} to queue`" @click="addToQueue(song)">＋</button>
          </article>
        </section>

        <section id="catalog" class="catalog-section">
          <div class="catalog-heading">
            <div>
              <span class="eyebrow">Browse the room</span>
              <h2>Music library</h2>
            </div>
            <div class="catalog-summary">
              <strong>{{ filteredSongs.length }}</strong>
              <span>{{ filteredSongs.length === 1 ? "track" : "tracks" }}</span>
            </div>
          </div>

          <div class="filterbar">
            <label class="filter-select">
              <span>Genre</span>
              <select v-model="genre" aria-label="Filter by genre">
                <option value="all">All genres</option>
                <option v-for="option in genres" :key="option" :value="option">{{ option }}</option>
              </select>
            </label>
            <label class="requester-field">
              <span aria-hidden="true">◎</span>
              <input v-model="requestedBy" placeholder="Your name (optional)" aria-label="Your name for queue requests" />
            </label>
            <label class="toggle-control">
              <input v-model="artworkOnly" type="checkbox" />
              <span class="toggle-track"><i></i></span>
              <span>With artwork</span>
            </label>
            <label class="sort-control">
              <span>Sort by</span>
              <select v-model="sortBy" aria-label="Sort tracks">
                <option value="recent">Recently added</option>
                <option value="title">Track title</option>
                <option value="artist">Artist</option>
                <option value="duration">Longest</option>
              </select>
            </label>
            <button class="filter-icon-button" type="button" :disabled="store.loading.songs" aria-label="Refresh library" title="Refresh library" @click="store.fetchSongs()">↻</button>
          </div>

          <div class="track-list" :class="{ 'is-loading': store.loading.songs }">
            <article
              v-for="song in filteredSongs"
              :key="song.id"
              class="track-row"
              :class="{ 'is-playing': store.player.nowPlaying?.id === song.id }"
            >
              <button class="row-play" type="button" :disabled="store.loading.queueAdd" :aria-label="`Add ${song.title} to queue`" @click="addToQueue(song)">
                <span v-if="store.player.nowPlaying?.id === song.id" class="playing-bars" aria-hidden="true"><i></i><i></i><i></i></span>
                <span v-else aria-hidden="true">▶</span>
              </button>
              <div class="media-cover track-cover" :style="getSongCoverStyle(song)">
                <img v-if="artworkUrl(song)" :src="artworkUrl(song)" alt="" @error="markArtworkFailed(song)" />
                <span v-else>{{ getSongInitials(song) }}</span>
              </div>
              <div class="track-identity">
                <strong>{{ song.title }}</strong>
                <span>{{ song.artist || "Unknown artist" }}<template v-if="song.album"> · {{ song.album }}</template></span>
              </div>
              <div class="track-tags">
                <span v-if="song.genre">{{ song.genre }}</span>
                <span v-if="song.year">{{ song.year }}</span>
              </div>
              <span class="track-duration">{{ formatDuration(Number(song.duration || 0)) }}</span>
              <div class="mini-wave" aria-hidden="true">
                <i v-for="(height, index) in getWaveBars(song)" :key="index" :style="{ height: `${height}%` }"></i>
              </div>
              <div class="track-actions">
                <span v-if="queuedSongCounts[song.id]" class="queued-badge">{{ queuedSongCounts[song.id] }} queued</span>
                <button class="row-action row-action-primary" type="button" :disabled="store.loading.queueAdd" title="Add to queue" :aria-label="`Add ${song.title} to queue`" @click="addToQueue(song)">＋</button>
                <button class="row-action row-action-danger" type="button" :disabled="store.loading.admin" title="Delete track" :aria-label="`Delete ${song.title}`" @click="removeSong(song)">×</button>
              </div>
            </article>

            <div v-if="store.loading.songs && !store.songs.length" class="empty-state">
              <span class="empty-icon is-spinning" aria-hidden="true">↻</span>
              <h3>Loading your library</h3>
              <p>Fetching tracks from the jukebox server…</p>
            </div>
            <div v-else-if="!filteredSongs.length" class="empty-state">
              <span class="empty-icon" aria-hidden="true">♫</span>
              <h3>{{ store.songs.length ? "No matching tracks" : "Your library is ready for music" }}</h3>
              <p>{{ store.songs.length ? "Try another search or clear a filter." : "Upload the first track to start the room." }}</p>
              <button v-if="!store.songs.length" class="button button-primary" type="button" @click="openPanel('upload')">Upload a track</button>
            </div>
          </div>
        </section>
      </main>
    </div>

    <div v-if="queueOpen" class="drawer-backdrop" @click="queueOpen = false"></div>
    <aside class="queue-drawer" :class="{ 'is-open': queueOpen }" aria-label="Playback queue" :aria-hidden="!queueOpen">
      <header class="drawer-header">
        <div>
          <span class="eyebrow">Shared session</span>
          <h2>Up next</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close queue" @click="queueOpen = false">×</button>
      </header>

      <section v-if="store.player.nowPlaying" class="queue-now-playing">
        <div class="media-cover media-cover-lg" :style="getSongCoverStyle(store.player.nowPlaying)">
          <img v-if="artworkUrl(store.player.nowPlaying)" :src="artworkUrl(store.player.nowPlaying)" alt="" @error="markArtworkFailed(store.player.nowPlaying)" />
          <span v-else>{{ getSongInitials(store.player.nowPlaying) }}</span>
        </div>
        <span class="eyebrow">Playing now</span>
        <strong>{{ store.player.nowPlaying.title }}</strong>
        <p>{{ store.player.nowPlaying.artist || "Unknown artist" }}</p>
      </section>

      <div class="queue-toolbar">
        <span>{{ store.queuedItems.length }} upcoming</span>
        <button type="button" :class="{ 'is-active': store.player.loopQueue }" @click="store.adminAction('/api/player/loop', { enabled: !store.player.loopQueue })">↻ Loop</button>
      </div>

      <ol v-if="store.queuedItems.length" class="queue-list">
        <li v-for="(item, index) in store.queuedItems" :key="item.id">
          <span class="queue-number">{{ String(index + 1).padStart(2, "0") }}</span>
          <div class="media-cover queue-cover" :style="getSongCoverStyle(item.song)">
            <img v-if="artworkUrl(item.song)" :src="artworkUrl(item.song)" alt="" @error="markArtworkFailed(item.song)" />
            <span v-else>{{ getSongInitials(item.song) }}</span>
          </div>
          <div>
            <strong>{{ item.song.title }}</strong>
            <span>{{ item.song.artist || "Unknown artist" }}</span>
            <small v-if="item.requestedBy">Requested by {{ item.requestedBy }}</small>
          </div>
          <time>{{ formatDuration(Number(item.song.duration || 0)) }}</time>
        </li>
      </ol>
      <div v-else class="drawer-empty">
        <span aria-hidden="true">☷</span>
        <h3>The queue is open</h3>
        <p>Add a track from the library and it will show up here for everyone.</p>
        <button class="button button-secondary" type="button" @click="queueOpen = false; scrollToCatalog()">Browse music</button>
      </div>

      <footer class="drawer-footer">
        <button class="button button-quiet" type="button" :disabled="store.loading.queue || store.loading.player" @click="store.refreshRealtime()">Refresh</button>
        <button class="button button-danger" type="button" :disabled="store.loading.admin || !store.queuedItems.length" @click="store.clearQueue()">Clear upcoming</button>
      </footer>
    </aside>

    <div v-if="activePanel" class="modal-backdrop" @click.self="closePanel">
      <section class="modal-panel" role="dialog" aria-modal="true" :aria-labelledby="`${activePanel}-panel-title`">
        <header class="modal-header">
          <div>
            <span class="eyebrow">{{ activePanel === "upload" ? "Contribute" : "Administration" }}</span>
            <h2 :id="`${activePanel}-panel-title`">{{ activePanel === "upload" ? "Upload music" : "Studio controls" }}</h2>
            <p>{{ activePanel === "upload" ? "Add a track and we’ll scan its embedded details." : "Configure protected server playback and output." }}</p>
          </div>
          <button class="modal-close" type="button" aria-label="Close panel" @click="closePanel">×</button>
        </header>
        <UploadPanel v-if="activePanel === 'upload'" />
        <AdminPanel v-else />
      </section>
    </div>

    <PlayerDock @toggle-queue="queueOpen = !queueOpen" />
  </div>
</template>

