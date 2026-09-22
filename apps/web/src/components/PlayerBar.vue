<script setup>
import { computed, ref } from 'vue';
import ArtThumb from './ArtThumb.vue';
import { usePlayerStore } from '../stores/player';
import { useQueueStore } from '../stores/queue';
import { formatTime } from '../lib/format';

const player = usePlayerStore();
const queue = useQueueStore();

const scrubValue = ref(0);
const scrubbing = ref(false);

const duration = computed(() => Number(player.nowPlaying?.duration) || 0);
const position = computed(() => (scrubbing.value ? scrubValue.value : player.positionSeconds));
const hasTrack = computed(() => Boolean(player.nowPlaying));

const transportLabel = computed(() => (player.state === 'playing' ? 'Pause' : 'Play'));

function startScrub(event) {
  scrubbing.value = true;
  player.seeking = true;
  scrubValue.value = Number(event.target.value);
}

function onScrub(event) {
  scrubValue.value = Number(event.target.value);
}

async function commitScrub() {
  if (!scrubbing.value) return;
  const value = scrubValue.value;
  scrubbing.value = false;
  player.seeking = false;
  try {
    await player.seek(value);
  } catch {
    /* error already surfaced as a toast */
  }
}

function onVolume(event) {
  player.setVolume(Number(event.target.value)).catch(() => {});
}

const volumeIcon = computed(() => {
  if (player.volume === 0) return '🔇';
  if (player.volume < 40) return '🔈';
  if (player.volume < 75) return '🔉';
  return '🔊';
});
</script>

<template>
  <footer class="player-bar" aria-label="Player controls">
    <div class="pb-track">
      <ArtThumb class="pb-art" :song="player.nowPlaying" size="56px" />
      <div class="pb-meta">
        <span class="pb-title truncate">{{ player.nowPlaying?.title || 'Nothing playing' }}</span>
        <span class="pb-artist truncate muted">
          {{ player.nowPlaying?.artist || (player.nowPlaying ? 'Unknown artist' : player.queueStopped ? 'Queue stopped' : 'Queue idle') }}
        </span>
      </div>
    </div>

    <div class="pb-center">
      <div class="pb-buttons">
        <button
          class="btn btn-icon"
          type="button"
          :aria-label="player.queueStopped ? 'Start queue playback' : 'Stop queue playback'"
          :title="player.queueStopped ? 'Start queue' : 'Stop queue'"
          @click="player.queueStopped ? player.start() : player.stop()"
        >
          <span aria-hidden="true">{{ player.queueStopped ? '⏻' : '⏹' }}</span>
        </button>

        <button
          class="btn btn-icon pb-play"
          type="button"
          :aria-label="transportLabel"
          :title="transportLabel"
          @click="player.toggle()"
        >
          <span aria-hidden="true">{{ player.state === 'playing' ? '❚❚' : '▶' }}</span>
        </button>

        <button
          class="btn btn-icon"
          type="button"
          aria-label="Skip to the next track"
          title="Skip"
          @click="player.skip()"
        >
          <span aria-hidden="true">⏭</span>
        </button>

        <button
          class="btn btn-icon pb-loop"
          type="button"
          :class="{ on: player.loopQueue }"
          :aria-pressed="player.loopQueue"
          aria-label="Toggle queue loop"
          title="Loop queue"
          @click="player.toggleLoop()"
        >
          <span aria-hidden="true">⟲</span>
        </button>
      </div>

      <div class="pb-progress">
        <span class="pb-time" aria-hidden="true">{{ formatTime(position) }}</span>
        <input
          class="pb-range"
          type="range"
          min="0"
          :max="duration || 1"
          step="1"
          :value="position"
          :disabled="!hasTrack || duration <= 0"
          aria-label="Seek position"
          :aria-valuetext="`${formatTime(position)} of ${formatTime(duration)}`"
          @mousedown="startScrub"
          @touchstart="startScrub"
          @input="onScrub"
          @change="commitScrub"
          @mouseup="commitScrub"
          @touchend="commitScrub"
        />
        <span class="pb-time" aria-hidden="true">{{ formatTime(duration) }}</span>
      </div>
    </div>

    <div class="pb-right">
      <RouterLink to="/" class="pb-queue" title="Songs waiting in the queue">
        <span aria-hidden="true">☰</span>
        <span class="visually-hidden">Queue:</span>
        <span class="pb-queue-count">{{ queue.count }}</span>
      </RouterLink>

      <div class="pb-volume">
        <span class="pb-vol-icon" aria-hidden="true">{{ volumeIcon }}</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="player.volume"
          aria-label="Room volume"
          :aria-valuetext="`${player.volume} percent`"
          @input="onVolume"
        />
        <span class="pb-vol-value" aria-hidden="true">{{ player.volume }}%</span>
      </div>

      <RouterLink
        to="/admin"
        class="pb-device truncate"
        :title="player.audioOutput?.message || 'Audio output device'"
      >
        <span aria-hidden="true">🖧</span>
        <span class="pb-device-name truncate">
          {{ player.audioOutput?.deviceId || 'Default output' }}
        </span>
      </RouterLink>
    </div>
  </footer>
</template>

<style scoped>
.player-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--player-h);
  z-index: 95;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 1rem;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
}

.pb-track {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}

.pb-art {
  flex: none;
  width: 56px;
  height: 56px;
}

.pb-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.pb-title {
  font-weight: 650;
  font-size: 0.92rem;
}

.pb-artist {
  font-size: 0.8rem;
}

.pb-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  width: 100%;
}

.pb-buttons {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.pb-play {
  width: 42px;
  height: 42px;
  background: var(--text);
  color: #111;
  border-color: var(--text);
  font-size: 0.85rem;
}

.pb-play:hover:not(:disabled) {
  background: #fff;
  border-color: #fff;
}

.pb-loop.on {
  color: var(--accent);
  border-color: var(--accent);
}

.pb-progress {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  max-width: 560px;
}

.pb-time {
  font-size: 0.72rem;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  min-width: 34px;
  text-align: center;
}

.pb-range {
  flex: 1;
}

.pb-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.85rem;
  min-width: 0;
}

.pb-queue {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--text-dim);
  font-size: 0.82rem;
  font-weight: 600;
  text-decoration: none;
}

.pb-queue:hover {
  color: var(--text);
  text-decoration: none;
}

.pb-queue-count {
  background: var(--surface-3);
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
  font-size: 0.72rem;
}

.pb-volume {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 150px;
}

.pb-vol-icon {
  font-size: 0.85rem;
}

.pb-vol-value {
  font-size: 0.72rem;
  color: var(--text-faint);
  min-width: 30px;
  font-variant-numeric: tabular-nums;
}

.pb-device {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 130px;
  font-size: 0.75rem;
  color: var(--text-faint);
  text-decoration: none;
}

.pb-device:hover {
  color: var(--text-dim);
  text-decoration: none;
}

@media (max-width: 1100px) {
  .pb-device {
    display: none;
  }
}

@media (max-width: 900px) {
  .player-bar {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    height: auto;
    gap: 0.35rem 0.75rem;
    padding: 0.5rem 0.75rem calc(0.5rem + env(safe-area-inset-bottom, 0px));
  }

  .pb-track {
    grid-column: 1;
    grid-row: 1;
  }

  .pb-right {
    grid-column: 2;
    grid-row: 1;
    gap: 0.5rem;
  }

  .pb-volume {
    width: 92px;
  }

  .pb-vol-value {
    display: none;
  }

  .pb-center {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .pb-progress {
    max-width: none;
  }
}

@media (max-width: 520px) {
  .pb-art {
    width: 44px;
    height: 44px;
  }
}
</style>
