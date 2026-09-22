<script setup>
import { computed, onMounted, ref } from 'vue';
import ArtThumb from '../components/ArtThumb.vue';
import QueueItemRow from '../components/QueueItemRow.vue';
import MoodCard from '../components/MoodCard.vue';
import ChatPanel from '../components/ChatPanel.vue';
import SongCard from '../components/SongCard.vue';
import { usePlayerStore } from '../stores/player';
import { useQueueStore } from '../stores/queue';
import { useLibraryStore } from '../stores/library';
import { useMoodsStore } from '../stores/moods';
import { formatTime } from '../lib/format';

const player = usePlayerStore();
const queue = useQueueStore();
const library = useLibraryStore();
const moods = useMoodsStore();

const scrubbing = ref(false);
const scrubValue = ref(0);

const duration = computed(() => Number(player.nowPlaying?.duration) || 0);
const position = computed(() => (scrubbing.value ? scrubValue.value : player.positionSeconds));
const progressPct = computed(() => (duration.value > 0 ? (position.value / duration.value) * 100 : 0));

const upcoming = computed(() => queue.queue.filter((item) => item.status !== 'playing'));
const nowItem = computed(() => queue.nowPlaying);

onMounted(() => {
  if (!queue.loaded) queue.fetch();
  if (!moods.loaded) moods.fetch();
  if (!library.loaded) library.fetch();
});

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
    /* toast already raised */
  }
}
</script>

<template>
  <div>
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
        </div>
      </div>
    </section>

    <!-- Queue -->
    <section class="section">
      <div class="section-head">
        <h2>Up next</h2>
        <span class="sub">{{ upcoming.length }} in the queue</span>
      </div>

      <div v-if="queue.loading && !queue.loaded" class="empty">Loading the queue…</div>
      <div v-else-if="!upcoming.length" class="empty">
        The queue is empty. Head to the
        <RouterLink to="/library">library</RouterLink> and add something.
      </div>
      <ul v-else class="qlist panel">
        <QueueItemRow
          v-for="(item, index) in upcoming"
          :key="item.id"
          :item="item"
          :index="index"
        />
      </ul>
    </section>

    <!-- Room chat -->
    <ChatPanel />

    <!-- Moods -->
    <section class="section">
      <div class="section-head">
        <h2>Moods</h2>
        <RouterLink to="/moods" class="sub">Browse all</RouterLink>
      </div>
      <div v-if="!moods.moods.length" class="empty">
        No moods yet. An admin can create them on the <RouterLink to="/admin">admin</RouterLink> page.
      </div>
      <div v-else class="card-row">
        <MoodCard v-for="mood in moods.moods" :key="mood.id" :mood="mood" />
      </div>
    </section>

    <!-- Recently added -->
    <section class="section">
      <div class="section-head">
        <h2>Recently added</h2>
        <RouterLink to="/library" class="sub">Open library</RouterLink>
      </div>
      <div v-if="!library.recentlyAdded.length" class="empty">
        Nothing in the library yet — <RouterLink to="/upload">upload a track</RouterLink>.
      </div>
      <div v-else class="card-row">
        <SongCard v-for="song in library.recentlyAdded" :key="song.id" :song="song" compact />
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 1.5rem;
  background: linear-gradient(120deg, #17211f 0%, var(--surface) 55%);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1.5rem;
}

.hero-art {
  width: 260px;
  height: 260px;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
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
  font-size: 2rem;
  line-height: 1.15;
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
  margin: 1.1rem 0 0.9rem;
  position: relative;
}

.hero-bar {
  height: 4px;
  border-radius: 4px;
  background: var(--surface-3);
  overflow: hidden;
}

.hero-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.4s linear;
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
  gap: 0.5rem;
  flex-wrap: wrap;
}

.qlist {
  padding: 0.5rem;
}

@media (max-width: 860px) {
  .hero {
    grid-template-columns: 1fr;
    padding: 1rem;
  }

  .hero-art {
    width: 100%;
    height: auto;
    max-width: 320px;
  }

  .hero-title {
    font-size: 1.5rem;
  }

  .hero-range {
    opacity: 1;
  }

  .hero-bar {
    display: none;
  }
}
</style>
