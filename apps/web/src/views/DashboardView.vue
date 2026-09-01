<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AdminPanel from "../components/AdminPanel.vue";
import PlayerDock from "../components/PlayerDock.vue";
import UploadPanel from "../components/UploadPanel.vue";
import { useJukeboxStore } from "../stores/jukebox";
import { formatDuration, getSongArtworkUrl, getSongCoverStyle, getSongInitials, getSongMediaUrl } from "../utils/media";

const store = useJukeboxStore();
const route = useRoute();
const router = useRouter();
const query = ref("");
const externalProvider = ref("archive");
const genre = ref("all");
const sortBy = ref("recent");
const queueOpen = ref(false);
const filtersOpen = ref(false);
const selectedSong = ref(null);
const previewSong = ref(null);
const requestedBy = ref(localStorage.getItem("jukebox-requester-name") || "");
const failedArtwork = ref(new Set());

const activePanel = computed(() => route.path === "/upload" ? "upload" : route.path === "/admin" ? "admin" : null);
const genres = computed(() => [...new Set(store.songs.map((song) => song.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
const nowPlaying = computed(() => store.player.nowPlaying || null);
const queuedSongCounts = computed(() => store.queuedItems.reduce((counts, item) => {
  counts[item.song.id] = (counts[item.song.id] || 0) + 1;
  return counts;
}, {}));
const filteredSongs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  const songs = store.songs.filter((song) => {
    const searchable = [song.title, song.artist, song.album, song.genre].filter(Boolean).join(" ").toLowerCase();
    return (!needle || searchable.includes(needle)) && (genre.value === "all" || song.genre === genre.value);
  });
  if (sortBy.value === "title") return [...songs].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  if (sortBy.value === "artist") return [...songs].sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
  return songs;
});
const hasFilters = computed(() => genre.value !== "all" || sortBy.value !== "recent");
const overlayOpen = computed(() => queueOpen.value || filtersOpen.value || selectedSong.value || previewSong.value || activePanel.value);

watch(requestedBy, (value) => localStorage.setItem("jukebox-requester-name", value));
watch(overlayOpen, (open) => document.body.classList.toggle("sheet-open", Boolean(open)));
watch(query, () => store.clearExternalSearch());
watch(externalProvider, () => store.clearExternalSearch());

function artworkUrl(song) {
  if (!song || failedArtwork.value.has(song.id)) return "";
  return getSongArtworkUrl(song);
}

function markArtworkFailed(song) {
  const next = new Set(failedArtwork.value);
  next.add(song.id);
  failedArtwork.value = next;
}

function addToQueue(song, playNext = false) {
  selectedSong.value = null;
  store.addToQueue(song.id, requestedBy.value, playNext);
}

function selectMood(mood) {
  if (store.queuedItems.length && !window.confirm(`Replace the upcoming queue with “${mood.name}”?`)) return;
  store.selectMood(mood.id, requestedBy.value);
}

function searchExternal() {
  if (query.value.trim().length < 2) return;
  store.searchExternal(externalProvider.value, query.value);
}

function importExternal(result, queueAfterImport = false) {
  store.importExternal(result, requestedBy.value, queueAfterImport);
}

function openPreview(song) {
  selectedSong.value = null;
  previewSong.value = song;
}

function isVideo(song) {
  return song?.mimeType?.startsWith("video/") || song?.filename?.toLowerCase().endsWith(".mp4");
}

function removeSong(song) {
  if (!window.confirm(`Permanently delete “${song.title}” from the library?`)) return;
  selectedSong.value = null;
  store.deleteSong(song.id);
}

function closePanel() {
  if (activePanel.value) router.push("/");
}

function clearFilters() {
  genre.value = "all";
  sortBy.value = "recent";
}

function closeTransientLayers() {
  queueOpen.value = false;
  filtersOpen.value = false;
  selectedSong.value = null;
  previewSong.value = null;
}

function handleKeydown(event) {
  if (event.key !== "Escape") return;
  closeTransientLayers();
  closePanel();
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
  document.body.classList.remove("sheet-open");
});
</script>

<template>
  <div class="jukebox-shell">
    <header class="app-header">
      <RouterLink to="/" class="app-brand" aria-label="Jukie home">
        <span class="brand-disc" aria-hidden="true">♪</span>
        <span><strong>Jukie</strong><small>Shared jukebox</small></span>
      </RouterLink>
      <div class="header-status" :class="{ online: store.socketConnected }">
        <i></i>{{ store.socketConnected ? "Live" : "Offline" }}
      </div>
      <button class="header-queue" type="button" @click="queueOpen = true" aria-label="Open queue">
        <span aria-hidden="true">☷</span><b>{{ store.queuedItems.length }}</b>
      </button>
    </header>

    <main class="app-content">
      <section class="now-card" :class="{ empty: !nowPlaying }">
        <div class="now-cover media-cover" :style="getSongCoverStyle(nowPlaying)">
          <img v-if="artworkUrl(nowPlaying)" :src="artworkUrl(nowPlaying)" alt="" @error="markArtworkFailed(nowPlaying)" />
          <span v-else>{{ nowPlaying ? getSongInitials(nowPlaying) : "♪" }}</span>
        </div>
        <div class="now-copy">
          <span class="section-kicker">{{ nowPlaying ? (store.player.state === "paused" ? "Paused" : "Playing in the room") : "The room is quiet" }}</span>
          <h1>{{ nowPlaying?.title || "Pick the next track" }}</h1>
          <p>{{ nowPlaying?.artist || (store.queuedItems.length ? `${store.queuedItems.length} track(s) ready` : "Browse the library and start the vibe.") }}</p>
          <button v-if="nowPlaying" class="text-action" type="button" @click="openPreview(nowPlaying)">Preview on this phone</button>
        </div>
        <button class="now-queue-button" type="button" @click="queueOpen = true">
          <b>{{ store.queuedItems.length }}</b><span>Up next</span>
        </button>
      </section>

      <section class="browse-section">
        <div v-if="store.moods.length || store.loading.moods" class="moods-section">
          <div class="section-title-row">
            <div><span class="section-kicker">One tap playlist</span><h2>Moods</h2></div>
            <span>Replaces up next</span>
          </div>
          <div class="mood-list">
            <button
              v-for="mood in store.moods"
              :key="mood.id"
              class="mood-card"
              type="button"
              :disabled="store.loading.moodSelect || !mood.songs.length"
              @click="selectMood(mood)"
            >
              <span class="mood-icon" aria-hidden="true">♫</span>
              <span><strong>{{ mood.name }}</strong><small>{{ mood.songs.length }} {{ mood.songs.length === 1 ? "song" : "songs" }}</small></span>
              <b aria-hidden="true">▶</b>
            </button>
          </div>
        </div>

        <div class="section-title-row">
          <div><span class="section-kicker">Choose the vibe</span><h2>Music library</h2></div>
          <span>{{ filteredSongs.length }} {{ filteredSongs.length === 1 ? "track" : "tracks" }}</span>
        </div>

        <div class="browse-tools">
          <label class="mobile-search">
            <span aria-hidden="true">⌕</span>
            <input v-model="query" type="search" placeholder="Search songs, artists or albums" aria-label="Search library" />
            <button v-if="query" type="button" aria-label="Clear search" @click="query = ''">×</button>
          </label>
          <button class="filter-button" :class="{ active: hasFilters }" type="button" @click="filtersOpen = true" aria-label="Open filters">☰</button>
        </div>

        <section v-if="query.trim().length >= 2" class="external-search">
          <div class="external-search-controls">
            <div>
              <strong>{{ filteredSongs.length ? "Search beyond the library" : "Not in the library?" }}</strong>
              <small>Find public-domain audio to import, or search official YouTube links.</small>
            </div>
            <select v-model="externalProvider" class="input" aria-label="Music service">
              <option value="archive">Public-domain audio</option>
              <option value="youtube">YouTube</option>
            </select>
            <button class="button button-secondary" type="button" :disabled="store.loading.externalSearch" @click="searchExternal">
              {{ store.loading.externalSearch ? "Searching…" : "Search service" }}
            </button>
          </div>

          <div v-if="store.externalResults.length" class="external-result-list">
            <article v-for="result in store.externalResults" :key="`${result.provider}:${result.id}`" class="external-result-card">
              <img v-if="result.artworkUrl" :src="result.artworkUrl" alt="" loading="lazy" />
              <span v-else class="external-result-placeholder" aria-hidden="true">♫</span>
              <div class="external-result-copy">
                <strong>{{ result.title }}</strong>
                <span>{{ result.artist }}</span>
                <small>{{ result.providerName }}<template v-if="result.licenseName"> · {{ result.licenseName }}</template></small>
                <div class="external-attribution-links">
                  <a :href="result.externalUrl" target="_blank" rel="noopener noreferrer">Source</a>
                  <a v-if="result.licenseUrl" :href="result.licenseUrl" target="_blank" rel="noopener noreferrer">License</a>
                </div>
              </div>
              <div v-if="result.importable" class="external-result-actions">
                <button class="button button-secondary" type="button" :disabled="store.loading.externalImport" @click="importExternal(result)">
                  {{ result.importedSongId ? "In library" : "Import" }}
                </button>
                <button class="button button-primary" type="button" :disabled="store.loading.externalImport" @click="importExternal(result, true)">Import + queue</button>
              </div>
              <div v-else class="external-result-actions external-link-actions">
                <a class="button button-primary" :href="result.externalUrl" target="_blank" rel="noopener noreferrer">Open on YouTube</a>
                <small>{{ result.importReason }}</small>
              </div>
            </article>
          </div>
        </section>

        <label class="requester-card">
          <span class="requester-avatar" aria-hidden="true">☺</span>
          <span><strong>Who’s requesting?</strong><small>Your name appears in the shared queue.</small></span>
          <input v-model="requestedBy" maxlength="40" placeholder="Your name" aria-label="Your requester name" />
        </label>

        <div class="song-list" :class="{ loading: store.loading.songs }">
          <article v-for="song in filteredSongs" :key="song.id" class="song-card" :class="{ playing: nowPlaying?.id === song.id }">
            <button class="song-cover media-cover" :style="getSongCoverStyle(song)" type="button" :aria-label="`Preview ${song.title}`" @click="openPreview(song)">
              <img v-if="artworkUrl(song)" :src="artworkUrl(song)" alt="" @error="markArtworkFailed(song)" />
              <span v-else>{{ getSongInitials(song) }}</span>
              <i aria-hidden="true">▶</i>
            </button>
            <div class="song-copy">
              <strong>{{ song.title }}</strong>
              <span>{{ song.artist || "Unknown artist" }}<template v-if="song.album"> · {{ song.album }}</template></span>
              <small>
                <template v-if="song.genre">{{ song.genre }} · </template>{{ formatDuration(Number(song.duration || 0)) }}
                <template v-if="queuedSongCounts[song.id]"> · {{ queuedSongCounts[song.id] }} queued</template><template v-if="song.sourceProvider"> · {{ song.sourceProvider === "archive" ? "Internet Archive" : song.sourceProvider }}</template>
              </small>
            </div>
            <button class="more-button" type="button" :aria-label="`More actions for ${song.title}`" @click="selectedSong = song">•••</button>
            <button class="queue-add-button" type="button" :disabled="store.loading.queueAdd" :aria-label="`Add ${song.title} to queue`" @click="addToQueue(song)">
              <span aria-hidden="true">＋</span><span>Queue</span>
            </button>
          </article>

          <div v-if="store.loading.songs && !store.songs.length" class="friendly-empty">
            <span class="spinner" aria-hidden="true"></span><h3>Loading the library</h3><p>Finding the room’s music…</p>
          </div>
          <div v-else-if="!filteredSongs.length" class="friendly-empty">
            <span aria-hidden="true">♫</span><h3>{{ store.songs.length ? "No matches" : "No music yet" }}</h3>
            <p>{{ store.songs.length ? "Try a different search or clear your filters." : "Upload the first track and get the room started." }}</p>
            <button v-if="store.songs.length" class="button button-secondary" type="button" @click="query = ''; clearFilters()">Clear filters</button>
            <RouterLink v-else class="button button-primary" to="/upload">Upload music</RouterLink>
          </div>
        </div>
      </section>
    </main>

    <nav class="bottom-nav" aria-label="Main navigation">
      <RouterLink to="/" :class="{ active: route.path === '/' || route.path === '/library' }"><span>⌂</span><small>Browse</small></RouterLink>
      <button type="button" @click="queueOpen = true"><span>☷</span><small>Queue</small><b v-if="store.queuedItems.length">{{ store.queuedItems.length }}</b></button>
      <RouterLink to="/upload"><span>＋</span><small>Upload</small></RouterLink>
      <RouterLink to="/admin"><span>⚙</span><small>Admin</small></RouterLink>
    </nav>

    <PlayerDock @toggle-queue="queueOpen = true" />

    <div v-if="queueOpen" class="sheet-backdrop" @click.self="queueOpen = false">
      <section class="bottom-sheet queue-sheet" role="dialog" aria-modal="true" aria-labelledby="queue-title">
        <div class="sheet-handle"></div>
        <header class="sheet-header"><div><span class="section-kicker">Shared with everyone</span><h2 id="queue-title">Up next</h2></div><button type="button" @click="queueOpen = false" aria-label="Close queue">×</button></header>
        <div class="queue-summary">
          <span>{{ store.queuedItems.length }} upcoming</span>
          <button type="button" :class="{ active: store.player.loopQueue }" @click="store.adminAction('/api/player/loop', { enabled: !store.player.loopQueue })">↻ Loop</button>
        </div>
        <ol v-if="store.queuedItems.length" class="mobile-queue-list">
          <li v-for="(item, index) in store.queuedItems" :key="item.id">
            <span class="queue-position">{{ index + 1 }}</span>
            <div class="queue-art media-cover" :style="getSongCoverStyle(item.song)"><img v-if="artworkUrl(item.song)" :src="artworkUrl(item.song)" alt="" @error="markArtworkFailed(item.song)" /><span v-else>{{ getSongInitials(item.song) }}</span></div>
            <div><strong>{{ item.song.title }}</strong><span>{{ item.song.artist || "Unknown artist" }}</span><small>{{ item.requestedBy ? `Requested by ${item.requestedBy}` : "Anonymous request" }}</small></div>
            <button type="button" :disabled="store.loading.queueAdd" :aria-label="`Remove ${item.song.title}`" @click="store.removeQueueItem(item.id)">×</button>
          </li>
        </ol>
        <div v-else class="friendly-empty compact"><span>☷</span><h3>Nothing queued</h3><p>Add a song and it will appear here for everyone.</p><button class="button button-primary" type="button" @click="queueOpen = false">Browse songs</button></div>
        <footer v-if="store.queuedItems.length" class="sheet-footer"><button class="button button-danger button-wide" type="button" :disabled="store.loading.admin" @click="store.clearQueue()">Clear queue</button></footer>
      </section>
    </div>

    <div v-if="filtersOpen" class="sheet-backdrop" @click.self="filtersOpen = false">
      <section class="bottom-sheet compact-sheet" role="dialog" aria-modal="true" aria-labelledby="filters-title">
        <div class="sheet-handle"></div><header class="sheet-header"><h2 id="filters-title">Filter library</h2><button type="button" @click="filtersOpen = false" aria-label="Close filters">×</button></header>
        <div class="sheet-form"><label class="field"><span>Genre</span><select v-model="genre" class="input"><option value="all">All genres</option><option v-for="option in genres" :key="option" :value="option">{{ option }}</option></select></label><label class="field"><span>Sort by</span><select v-model="sortBy" class="input"><option value="recent">Recently added</option><option value="title">Title A–Z</option><option value="artist">Artist A–Z</option></select></label></div>
        <footer class="sheet-footer split"><button class="button button-secondary" type="button" @click="clearFilters">Reset</button><button class="button button-primary" type="button" @click="filtersOpen = false">Show {{ filteredSongs.length }} tracks</button></footer>
      </section>
    </div>

    <div v-if="selectedSong" class="sheet-backdrop" @click.self="selectedSong = null">
      <section class="bottom-sheet action-sheet" role="dialog" aria-modal="true" aria-labelledby="actions-title"><div class="sheet-handle"></div><header class="selected-song"><div class="media-cover" :style="getSongCoverStyle(selectedSong)"><img v-if="artworkUrl(selectedSong)" :src="artworkUrl(selectedSong)" alt="" /><span v-else>{{ getSongInitials(selectedSong) }}</span></div><div><h2 id="actions-title">{{ selectedSong.title }}</h2><p>{{ selectedSong.artist || "Unknown artist" }}</p></div><button type="button" @click="selectedSong = null" aria-label="Close actions">×</button></header><div class="action-list"><button type="button" @click="addToQueue(selectedSong)"><span>＋</span><div><strong>Add to queue</strong><small>Play after everyone already waiting</small></div></button><button type="button" @click="addToQueue(selectedSong, true)"><span>↥</span><div><strong>Play next</strong><small>Move it to the front of the upcoming queue</small></div></button><button type="button" @click="openPreview(selectedSong)"><span>▶</span><div><strong>Preview on this device</strong><small>Doesn’t affect the room</small></div></button><a v-if="selectedSong.sourceUrl" :href="selectedSong.sourceUrl" target="_blank" rel="noopener noreferrer"><span>↗</span><div><strong>View original source</strong><small>Open the recording’s provider page</small></div></a><a v-if="selectedSong.licenseUrl" :href="selectedSong.licenseUrl" target="_blank" rel="noopener noreferrer"><span>©</span><div><strong>View recording license</strong><small>Review reuse and attribution details</small></div></a><button class="danger-action" type="button" @click="removeSong(selectedSong)"><span>⌫</span><div><strong>Delete from library</strong><small>Admin action — cannot be undone</small></div></button></div></section>
    </div>

    <div v-if="previewSong" class="sheet-backdrop" @click.self="previewSong = null">
      <section class="bottom-sheet preview-sheet" role="dialog" aria-modal="true" aria-labelledby="preview-title"><div class="sheet-handle"></div><header class="sheet-header"><div><span class="section-kicker">Playing only here</span><h2 id="preview-title">{{ previewSong.title }}</h2><p>{{ previewSong.artist || "Unknown artist" }}</p></div><button type="button" @click="previewSong = null" aria-label="Close preview">×</button></header><video v-if="isVideo(previewSong)" class="device-preview" :src="getSongMediaUrl(previewSong)" controls autoplay playsinline></video><audio v-else class="device-preview audio" :src="getSongMediaUrl(previewSong)" controls autoplay></audio></section>
    </div>

    <div v-if="activePanel" class="page-overlay">
      <section class="panel-page" role="dialog" aria-modal="true" :aria-labelledby="`${activePanel}-title`"><header class="panel-page-header"><button type="button" @click="closePanel" aria-label="Go back">‹</button><div><span class="section-kicker">{{ activePanel === 'upload' ? 'Share with the room' : 'Protected settings' }}</span><h1 :id="`${activePanel}-title`">{{ activePanel === "upload" ? "Upload music" : "Jukebox admin" }}</h1></div></header><UploadPanel v-if="activePanel === 'upload'" /><AdminPanel v-else /></section>
    </div>
  </div>
</template>
