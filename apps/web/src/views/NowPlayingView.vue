<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();
const queuedItems = computed(() => store.queuedItems);
const pin = computed({
  get: () => store.adminPin,
  set: (value) => store.setAdminPin(value)
});

const tickMs = ref(Date.now());
const positionAnchorMs = ref(Date.now());
const isSeeking = ref(false);
const seekInputSeconds = ref(0);
let tickInterval = null;

const nowPlaying = computed(() => store.player.nowPlaying || null);
const basePositionSeconds = computed(() => {
  const nextPosition = Number(store.player.positionSeconds);
  return Number.isFinite(nextPosition) && nextPosition >= 0 ? nextPosition : 0;
});

const durationSeconds = computed(() => {
  const duration = Number(nowPlaying.value?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
});

watch(
  () => [store.player.state, store.player.nowPlaying?.id || null, store.player.positionSeconds],
  () => {
    positionAnchorMs.value = Date.now();
  },
  { immediate: true }
);

const livePositionSeconds = computed(() => {
  let position = basePositionSeconds.value;

  if (store.player.state === "playing") {
    position += (tickMs.value - positionAnchorMs.value) / 1000;
  }

  if (durationSeconds.value > 0) {
    position = Math.min(position, durationSeconds.value);
  }

  return Math.max(0, position);
});

const progressPercent = computed(() => {
  if (durationSeconds.value <= 0) {
    return 0;
  }

  return Math.min(100, (displayPositionSeconds.value / durationSeconds.value) * 100);
});

const canSeek = computed(() => Boolean(nowPlaying.value) && durationSeconds.value > 0);
const hasQueuedItems = computed(() => queuedItems.value.length > 0);

const pauseResumeLabel = computed(() => (store.player.state === "paused" ? "Resume" : "Pause"));
const canStartQueue = computed(() => !store.loading.admin && store.player.state === "idle" && hasQueuedItems.value);
const canPauseResume = computed(() => !store.loading.admin && Boolean(nowPlaying.value));
const loopQueueLabel = computed(() => (store.player.loopQueue ? "Loop Queue: On" : "Loop Queue: Off"));

const displayPositionSeconds = computed(() => {
  if (isSeeking.value) {
    return seekInputSeconds.value;
  }

  if (durationSeconds.value > 0) {
    return Math.min(livePositionSeconds.value, durationSeconds.value);
  }

  return livePositionSeconds.value;
});

watch(
  () => [livePositionSeconds.value, durationSeconds.value, nowPlaying.value?.id || null],
  () => {
    if (isSeeking.value) return;
    const max = durationSeconds.value > 0 ? durationSeconds.value : livePositionSeconds.value;
    seekInputSeconds.value = Math.min(livePositionSeconds.value, max || 0);
  },
  { immediate: true }
);

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }

  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getCoverArtStyle(song) {
  const seed = `${song?.id || "none"}:${song?.title || "untitled"}:${song?.artist || "unknown"}`;
  const hash = hashCode(seed);
  const hueA = hash % 360;
  const hueB = (hueA + 42) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hueA} 70% 45%), hsl(${hueB} 65% 35%))`
  };
}

function getCoverArtLabel(song) {
  const title = (song?.title || "").trim();
  const artist = (song?.artist || "").trim();
  const titleChar = title ? title[0] : "S";
  const artistChar = artist ? artist[0] : "?";
  return `${titleChar}${artistChar}`.toUpperCase();
}

function getSongArtworkUrl(song) {
  if (!song) return "";
  if (song.artworkUrl) return song.artworkUrl;
  if (song.artworkFilename && song.id) {
    return `/api/songs/${encodeURIComponent(song.id)}/artwork`;
  }
  return "";
}

function togglePause() {
  if (store.player.state === "paused") {
    store.adminAction("/api/player/resume");
    return;
  }

  store.adminAction("/api/player/pause");
}

function startQueue() {
  store.adminAction("/api/player/start");
}


function toggleLoopQueue() {
  store.adminAction("/api/player/loop", { enabled: !store.player.loopQueue });
}

function stopPlayback() {
  store.adminAction("/api/player/stop");
}

function skipTrack() {
  store.adminAction("/api/player/skip");
}

function clearQueue() {
  store.clearQueue();
}

function onSeekInput(event) {
  const nextValue = Number(event?.target?.value);
  if (!Number.isFinite(nextValue)) return;
  isSeeking.value = true;
  seekInputSeconds.value = nextValue;
}

function commitSeek() {
  if (!canSeek.value) {
    isSeeking.value = false;
    return;
  }

  const clampedTarget = Math.min(Math.max(0, seekInputSeconds.value), durationSeconds.value);
  seekInputSeconds.value = clampedTarget;
  isSeeking.value = false;
  store.adminAction("/api/player/seek", { positionSeconds: clampedTarget });
}

onMounted(() => {
  store.init();
  store.refreshRealtime();
  tickInterval = setInterval(() => {
    tickMs.value = Date.now();
  }, 500);
});

onUnmounted(() => {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
});
</script>

<template>
  <section class="card">
    <h2>Now Playing</h2>
    <p><small>Status: {{ store.player.state }} | Volume: {{ store.player.volume }}</small></p>

    <div v-if="nowPlaying" class="now-playing-layout">
      <div class="cover-art" :style="getCoverArtStyle(nowPlaying)">
        <img v-if="getSongArtworkUrl(nowPlaying)" :src="getSongArtworkUrl(nowPlaying)" alt="Album art" class="cover-art-image" />
        <span v-else>{{ getCoverArtLabel(nowPlaying) }}</span>
      </div>
      <div class="now-playing-meta">
        <p>
          <strong>{{ nowPlaying.title }}</strong>
          <span v-if="nowPlaying.artist"> — {{ nowPlaying.artist }}</span>
        </p>
        <p class="progress-time">
          <small>
            {{ formatDuration(displayPositionSeconds) }}
            <span v-if="durationSeconds"> / {{ formatDuration(durationSeconds) }}</span>
          </small>
        </p>
        <input
          class="progress-slider"
          type="range"
          :max="durationSeconds || 1"
          :value="displayPositionSeconds"
          step="0.1"
          :disabled="!canSeek || store.loading.admin"
          @input="onSeekInput"
          @change="commitSeek"
          :style="{ '--progress-percent': `${progressPercent}%` }"
        />
      </div>
    </div>
    <p v-else>No song playing.</p>

    <p>
      <input class="input" v-model="pin" placeholder="Admin PIN" type="password" />
    </p>

    <p>
      <button class="button" @click="startQueue" :disabled="!canStartQueue">
        Start Queue
      </button>
      <button class="button" @click="toggleLoopQueue" :disabled="store.loading.admin">
        {{ loopQueueLabel }}
      </button>
      <button class="button" @click="skipTrack" :disabled="store.loading.admin || !nowPlaying">
        Skip
      </button>
      <button class="button" @click="togglePause" :disabled="!canPauseResume">
        {{ pauseResumeLabel }}
      </button>
      <button class="button button-danger" @click="stopPlayback" :disabled="store.loading.admin || !nowPlaying">
        Stop
      </button>
      <button class="button button-danger" @click="clearQueue" :disabled="store.loading.admin || !queuedItems.length">
        Clear Queue
      </button>
    </p>

    <button class="button" @click="store.refreshRealtime" :disabled="store.loading.queue || store.loading.player">
      Refresh
    </button>
  </section>

  <section class="card">
    <h2>
      Upcoming Queue
      <span v-if="store.player.loopQueue" class="queue-loop-badge">Loop On</span>
    </h2>
    <ol v-if="queuedItems.length">
      <li v-for="item in queuedItems" :key="item.id">
        {{ item.song.title }}
        <span v-if="item.song.artist"> — {{ item.song.artist }}</span>
        <small>
          ({{ item.status }}<span v-if="item.requestedBy"> by {{ item.requestedBy }}</span>)
        </small>
      </li>
    </ol>
    <p v-else>There are no queued songs yet.</p>
  </section>
</template>
