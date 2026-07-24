<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useJukeboxStore } from "../stores/jukebox";
import { formatDuration, getSongArtworkUrl, getSongCoverStyle, getSongInitials } from "../utils/media";

const emit = defineEmits(["toggle-queue"]);
const store = useJukeboxStore();
const tickMs = ref(Date.now());
const positionAnchorMs = ref(Date.now());
const isSeeking = ref(false);
const seekInputSeconds = ref(0);
const volume = ref(store.player.volume ?? 80);
const waveformBars = Array.from({ length: 64 }, (_, index) => 25 + ((index * 37 + index * index * 11) % 68));
let tickInterval = null;

const nowPlaying = computed(() => store.player.nowPlaying || null);
const durationSeconds = computed(() => {
  const duration = Number(nowPlaying.value?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
});
const basePositionSeconds = computed(() => {
  const position = Number(store.player.positionSeconds);
  return Number.isFinite(position) && position >= 0 ? position : 0;
});
const livePositionSeconds = computed(() => {
  let position = basePositionSeconds.value;
  if (store.player.state === "playing") {
    position += (tickMs.value - positionAnchorMs.value) / 1000;
  }
  return Math.max(0, durationSeconds.value ? Math.min(position, durationSeconds.value) : position);
});
const displayPositionSeconds = computed(() => (isSeeking.value ? seekInputSeconds.value : livePositionSeconds.value));
const progressPercent = computed(() => durationSeconds.value > 0
  ? Math.min(100, (displayPositionSeconds.value / durationSeconds.value) * 100)
  : 0);
const canSeek = computed(() => Boolean(nowPlaying.value) && durationSeconds.value > 0);
const canPlay = computed(() => Boolean(nowPlaying.value) || (store.player.state === "idle" && store.queuedItems.length > 0));
const isPaused = computed(() => store.player.state === "paused");

watch(
  () => [store.player.state, store.player.nowPlaying?.id || null, store.player.positionSeconds],
  () => {
    positionAnchorMs.value = Date.now();
  },
  { immediate: true }
);

watch(
  () => livePositionSeconds.value,
  (position) => {
    if (!isSeeking.value) seekInputSeconds.value = position;
  },
  { immediate: true }
);

watch(
  () => store.player.volume,
  (nextVolume) => {
    if (Number.isFinite(nextVolume)) volume.value = nextVolume;
  }
);

function togglePlayback() {
  if (isPaused.value) {
    store.adminAction("/api/player/resume");
  } else if (nowPlaying.value) {
    store.adminAction("/api/player/pause");
  } else if (store.queuedItems.length) {
    store.adminAction("/api/player/start");
  }
}

function onSeekInput(event) {
  const position = Number(event.target.value);
  if (!Number.isFinite(position)) return;
  isSeeking.value = true;
  seekInputSeconds.value = position;
}

function commitSeek() {
  if (!canSeek.value) return;
  const positionSeconds = Math.min(Math.max(0, seekInputSeconds.value), durationSeconds.value);
  isSeeking.value = false;
  store.adminAction("/api/player/seek", { positionSeconds });
}

function commitVolume() {
  store.adminAction("/api/player/volume", { volume: volume.value });
}

onMounted(() => {
  tickInterval = setInterval(() => {
    tickMs.value = Date.now();
  }, 500);
});

onUnmounted(() => {
  if (tickInterval) clearInterval(tickInterval);
});
</script>

<template>
  <footer class="player-dock" :class="{ 'has-track': nowPlaying }">
    <div class="dock-track">
      <div class="media-cover dock-cover" :style="getSongCoverStyle(nowPlaying)">
        <img v-if="getSongArtworkUrl(nowPlaying)" :src="getSongArtworkUrl(nowPlaying)" alt="" />
        <span v-else>{{ getSongInitials(nowPlaying) }}</span>
      </div>
      <div class="dock-track-copy">
        <strong>{{ nowPlaying?.title || "Nothing playing" }}</strong>
        <span>{{ nowPlaying?.artist || (store.queuedItems.length ? "Queue ready" : "Choose a track from the library") }}</span>
      </div>
    </div>

    <div class="dock-transport">
      <div class="transport-buttons">
        <button
          class="icon-button"
          type="button"
          :class="{ 'is-active': store.player.loopQueue }"
          :disabled="store.loading.admin"
          :aria-label="store.player.loopQueue ? 'Disable queue loop' : 'Enable queue loop'"
          title="Loop queue"
          @click="store.adminAction('/api/player/loop', { enabled: !store.player.loopQueue })"
        >
          ↻
        </button>
        <button
          class="play-button"
          type="button"
          :disabled="store.loading.admin || !canPlay"
          :aria-label="isPaused || !nowPlaying ? 'Play' : 'Pause'"
          @click="togglePlayback"
        >
          <span aria-hidden="true">{{ isPaused || !nowPlaying ? "▶" : "Ⅱ" }}</span>
        </button>
        <button
          class="icon-button"
          type="button"
          :disabled="store.loading.admin || !nowPlaying"
          aria-label="Skip track"
          title="Skip"
          @click="store.adminAction('/api/player/skip')"
        >
          ▶|
        </button>
        <button
          class="icon-button stop-button"
          type="button"
          :disabled="store.loading.admin || !nowPlaying"
          aria-label="Stop playback"
          title="Stop"
          @click="store.adminAction('/api/player/stop')"
        >
          ■
        </button>
      </div>

      <div class="dock-timeline">
        <span>{{ formatDuration(displayPositionSeconds) }}</span>
        <div class="waveform-control" :class="{ 'is-disabled': !canSeek }">
          <div class="waveform" aria-hidden="true">
            <i
              v-for="(height, index) in waveformBars"
              :key="index"
              :class="{ 'is-played': (index / (waveformBars.length - 1)) * 100 <= progressPercent }"
              :style="{ height: `${height}%` }"
            ></i>
          </div>
          <input
            class="waveform-input"
            type="range"
            min="0"
            :max="durationSeconds || 1"
            step="0.1"
            :value="displayPositionSeconds"
            :disabled="!canSeek || store.loading.admin"
            aria-label="Track position"
            @input="onSeekInput"
            @change="commitSeek"
          />
        </div>
        <span>{{ durationSeconds ? formatDuration(durationSeconds) : "0:00" }}</span>
      </div>
    </div>

    <div class="dock-actions">
      <span class="volume-icon" aria-hidden="true">◖</span>
      <input
        v-model.number="volume"
        class="dock-volume range"
        type="range"
        min="0"
        max="100"
        step="1"
        aria-label="Volume"
        @change="commitVolume"
      />
      <button class="queue-button" type="button" @click="emit('toggle-queue')">
        <span aria-hidden="true">☷</span>
        <span>Queue</span>
        <b>{{ store.queuedItems.length }}</b>
      </button>
    </div>
  </footer>
</template>
