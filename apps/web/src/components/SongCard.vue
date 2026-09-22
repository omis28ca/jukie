<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ArtThumb from './ArtThumb.vue';
import { usePreview } from '../lib/preview';
import { useLibraryStore } from '../stores/library';
import { useQueueStore } from '../stores/queue';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import { formatTime } from '../lib/format';

const props = defineProps({
  song: { type: Object, required: true },
  compact: { type: Boolean, default: false }
});

const library = useLibraryStore();
const queue = useQueueStore();
const session = useSessionStore();
const ui = useUiStore();
const preview = usePreview();

const audioEl = ref(null);
const busy = ref('');
const previewing = computed(() => preview.activeSongId.value === props.song.id);
const mediaSrc = computed(() => library.mediaUrl(props.song));

watch(
  previewing,
  (isActive) => {
    const el = audioEl.value;
    if (!el) return;
    if (isActive) {
      el.play().catch((error) => {
        ui.error(error?.message || 'Preview failed to start');
        preview.stop(props.song.id);
      });
    } else {
      el.pause();
    }
  },
  { flush: 'post' }
);

onBeforeUnmount(() => {
  if (previewing.value) preview.stop(props.song.id);
});

function togglePreview() {
  if (previewing.value) preview.stop(props.song.id);
  else preview.start(props.song.id);
}

async function run(key, fn) {
  busy.value = key;
  try {
    await fn();
  } catch {
    /* toast already raised */
  } finally {
    busy.value = '';
  }
}

const add = () => run('add', () => queue.enqueue(props.song.id));
const playNext = () => run('next', () => queue.enqueue(props.song.id, { playNext: true }));

function remove() {
  if (!window.confirm(`Delete “${props.song.title}” from the library? This cannot be undone.`)) return;
  run('del', () => library.deleteSong(props.song.id));
}

const subtitle = computed(() =>
  [props.song.artist, props.song.album].filter(Boolean).join(' • ') || 'Unknown artist'
);
</script>

<template>
  <article class="song-card" :class="{ compact, previewing }">
    <div class="art-wrap">
      <ArtThumb :song="song" />
      <button
        class="preview-btn"
        type="button"
        :aria-pressed="previewing"
        :aria-label="previewing ? `Stop previewing ${song.title}` : `Preview ${song.title} in your browser only`"
        :title="previewing ? 'Stop preview' : 'Preview (headphones only — does not affect the room)'"
        @click="togglePreview"
      >
        <span aria-hidden="true">{{ previewing ? '❚❚' : '▶' }}</span>
      </button>
      <span v-if="song.duration" class="duration">{{ formatTime(song.duration) }}</span>
    </div>

    <div class="meta">
      <h3 class="title truncate" :title="song.title">{{ song.title }}</h3>
      <p class="sub truncate" :title="subtitle">{{ subtitle }}</p>
      <p v-if="song.genre" class="genre truncate">{{ song.genre }}</p>
    </div>

    <div class="actions">
      <button
        class="btn btn-sm btn-primary"
        type="button"
        :disabled="busy === 'add'"
        :aria-label="`Add ${song.title} to the queue`"
        @click="add"
      >
        Add
      </button>
      <button
        class="btn btn-sm"
        type="button"
        :disabled="busy === 'next'"
        :aria-label="`Play ${song.title} next`"
        @click="playNext"
      >
        Play next
      </button>
      <button
        v-if="session.isAdmin"
        class="btn btn-sm btn-danger"
        type="button"
        :disabled="busy === 'del'"
        :aria-label="`Delete ${song.title} from the library`"
        @click="remove"
      >
        Delete
      </button>
    </div>

    <audio
      v-if="previewing"
      ref="audioEl"
      class="preview-audio"
      :src="mediaSrc"
      controls
      preload="metadata"
      :aria-label="`Preview player for ${song.title}`"
      @ended="preview.stop(song.id)"
    ></audio>

    <p v-if="song.sourceUrl" class="attrib">
      <a :href="song.sourceUrl" target="_blank" rel="noopener noreferrer">Source</a>
      <template v-if="song.licenseUrl">
        ·
        <a :href="song.licenseUrl" target="_blank" rel="noopener noreferrer">License</a>
      </template>
    </p>
  </article>
</template>

<style scoped>
.song-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem;
  min-width: 0;
}

.song-card.previewing {
  border-color: var(--accent);
}

.art-wrap {
  position: relative;
}

.preview-btn {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(10, 10, 10, 0.8);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.7rem;
  display: grid;
  place-items: center;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.song-card:hover .preview-btn,
.preview-btn:focus-visible,
.song-card.previewing .preview-btn {
  opacity: 1;
}

.duration {
  position: absolute;
  left: 8px;
  bottom: 8px;
  font-size: 0.68rem;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: rgba(10, 10, 10, 0.75);
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.meta {
  min-width: 0;
}

.title {
  font-size: 0.88rem;
}

.sub,
.genre {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-dim);
}

.genre {
  color: var(--text-faint);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.preview-audio {
  width: 100%;
  height: 34px;
}

.attrib {
  margin: 0;
  font-size: 0.7rem;
  color: var(--text-faint);
}

@media (hover: none) {
  .preview-btn {
    opacity: 1;
  }
}
</style>
