<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useJukeboxStore } from "../stores/jukebox";
import { formatDuration, getSongArtworkUrl, getSongCoverStyle, getSongInitials } from "../utils/media";

const emit = defineEmits(["toggle-queue"]);
const store = useJukeboxStore();
const expanded = ref(false);
const tickMs = ref(Date.now());
const positionAnchorMs = ref(Date.now());
const seeking = ref(false);
const seekSeconds = ref(0);
let timer = null;

const song = computed(() => store.player.nowPlaying || null);
const duration = computed(() => Math.max(0, Number(song.value?.duration) || 0));
const position = computed(() => {
  if (seeking.value) return seekSeconds.value;
  let value = Math.max(0, Number(store.player.positionSeconds) || 0);
  if (store.player.state === "playing") value += (tickMs.value - positionAnchorMs.value) / 1000;
  return duration.value ? Math.min(value, duration.value) : value;
});
const progress = computed(() => duration.value ? Math.min(100, (position.value / duration.value) * 100) : 0);
const isPaused = computed(() => store.player.state === "paused");
const canToggle = computed(() => Boolean(song.value) || store.queuedItems.length > 0);

watch(() => [store.player.state, store.player.positionSeconds, song.value?.id], () => {
  positionAnchorMs.value = Date.now();
  if (!seeking.value) seekSeconds.value = Number(store.player.positionSeconds) || 0;
}, { immediate: true });

function togglePlayback() {
  if (isPaused.value) store.adminAction("/api/player/resume");
  else if (song.value) store.adminAction("/api/player/pause");
  else if (store.queuedItems.length) store.adminAction("/api/player/start");
}

function updateSeek(event) {
  seeking.value = true;
  seekSeconds.value = Number(event.target.value) || 0;
}

function commitSeek() {
  seeking.value = false;
  store.adminAction("/api/player/seek", { positionSeconds: seekSeconds.value });
}

onMounted(() => {
  timer = setInterval(() => { tickMs.value = Date.now(); }, 500);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="mobile-player" :class="{ empty: !song }">
    <div class="player-progress"><i :style="{ width: `${progress}%` }"></i></div>
    <button class="mini-track" type="button" :disabled="!song" @click="expanded = true">
      <span class="mini-cover media-cover" :style="getSongCoverStyle(song)">
        <img v-if="getSongArtworkUrl(song)" :src="getSongArtworkUrl(song)" alt="" />
        <span v-else>{{ song ? getSongInitials(song) : "♪" }}</span>
      </span>
      <span class="mini-copy"><strong>{{ song?.title || "Nothing playing" }}</strong><small>{{ song?.artist || (store.queuedItems.length ? "Queue ready to start" : "Add a track from the library") }}</small></span>
    </button>
    <button class="mini-control mini-play" type="button" :disabled="!canToggle || store.loading.admin" :aria-label="isPaused || !song ? 'Play' : 'Pause'" @click="togglePlayback">{{ isPaused || !song ? "▶" : "Ⅱ" }}</button>
    <button class="mini-control" type="button" :disabled="!song || store.loading.admin" aria-label="Skip track" @click="store.adminAction('/api/player/skip')">▶|</button>
    <button class="mini-queue" type="button" aria-label="Open queue" @click="emit('toggle-queue')">☷<b>{{ store.queuedItems.length }}</b></button>
  </div>

  <div v-if="expanded" class="sheet-backdrop player-backdrop" @click.self="expanded = false">
    <section class="bottom-sheet expanded-player" role="dialog" aria-modal="true" aria-labelledby="expanded-player-title">
      <div class="sheet-handle"></div>
      <header><button type="button" @click="expanded = false" aria-label="Close player">⌄</button><span>Now playing</span><button type="button" :class="{ active: store.player.loopQueue }" aria-label="Toggle queue loop" @click="store.adminAction('/api/player/loop', { enabled: !store.player.loopQueue })">↻</button></header>
      <div class="expanded-cover media-cover" :style="getSongCoverStyle(song)"><img v-if="getSongArtworkUrl(song)" :src="getSongArtworkUrl(song)" alt="" /><span v-else>{{ getSongInitials(song) }}</span></div>
      <div class="expanded-copy"><span class="section-kicker">{{ store.player.state === "paused" ? "Paused" : "Playing in the room" }}</span><h2 id="expanded-player-title">{{ song?.title || "Nothing playing" }}</h2><p>{{ song?.artist || "Choose a song from the library" }}</p></div>
      <div class="seek-row"><input type="range" min="0" :max="duration || 1" step="0.1" :value="position" :disabled="!song || !duration" @input="updateSeek" @change="commitSeek" /><div><span>{{ formatDuration(position) }}</span><span>{{ formatDuration(duration) }}</span></div></div>
      <div class="big-controls"><button type="button" :disabled="!song" aria-label="Stop playback" @click="store.adminAction('/api/player/stop')">■</button><button class="primary" type="button" :disabled="!canToggle" :aria-label="isPaused || !song ? 'Play' : 'Pause'" @click="togglePlayback">{{ isPaused || !song ? "▶" : "Ⅱ" }}</button><button type="button" :disabled="!song" aria-label="Skip track" @click="store.adminAction('/api/player/skip')">▶|</button></div>
      <button class="expanded-queue-link" type="button" @click="expanded = false; emit('toggle-queue')"><span>☷</span><strong>View shared queue</strong><b>{{ store.queuedItems.length }} upcoming</b><span>›</span></button>
    </section>
  </div>
</template>
