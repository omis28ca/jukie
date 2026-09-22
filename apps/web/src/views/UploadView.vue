<script setup>
import { computed, ref } from 'vue';
import ArtThumb from '../components/ArtThumb.vue';
import { uploadFile } from '../lib/api';
import { useLibraryStore } from '../stores/library';
import { useQueueStore } from '../stores/queue';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import { formatBytes, formatTime } from '../lib/format';

const ACCEPT = '.mp3,.mp4,.wav,.m4a,.flac';
const ALLOWED = ['.mp3', '.mp4', '.wav', '.m4a', '.flac'];

const library = useLibraryStore();
const queue = useQueueStore();
const session = useSessionStore();
const ui = useUiStore();

const fileInput = ref(null);
const dragging = ref(false);
const file = ref(null);
const title = ref('');
const artist = ref('');
const progress = ref(0);
const uploading = ref(false);
const uploaded = ref(null);

const canUpload = computed(() => Boolean(file.value) && !uploading.value);

function extensionOf(name) {
  const index = String(name).lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function setFile(candidate) {
  if (!candidate) return;
  const ext = extensionOf(candidate.name);
  if (!ALLOWED.includes(ext)) {
    ui.error(`“${ext || candidate.name}” is not supported. Allowed: ${ALLOWED.join(', ')}`);
    return;
  }
  file.value = candidate;
  uploaded.value = null;
  progress.value = 0;
  if (!title.value) {
    title.value = candidate.name.replace(/\.[^.]+$/, '');
  }
}

function onDrop(event) {
  dragging.value = false;
  const dropped = event.dataTransfer?.files?.[0];
  setFile(dropped);
}

function onPick(event) {
  setFile(event.target.files?.[0]);
  event.target.value = '';
}

function reset() {
  file.value = null;
  title.value = '';
  artist.value = '';
  progress.value = 0;
  uploading.value = false;
}

async function submit() {
  if (!file.value) return;
  const form = new FormData();
  form.append('file', file.value, file.value.name);
  if (title.value.trim()) form.append('title', title.value.trim());
  if (artist.value.trim()) form.append('artist', artist.value.trim());
  if (session.name) form.append('uploadedBy', session.name);

  uploading.value = true;
  progress.value = 0;
  try {
    const payload = await uploadFile('/api/songs/upload', form, {
      onProgress: (value) => {
        if (typeof value === 'number') progress.value = value;
      }
    });
    const song = payload?.song ?? null;
    uploaded.value = song;
    if (song) library.upsertSong(song);
    ui.success(`Uploaded “${song?.title || file.value.name}”`);
    reset();
  } catch (error) {
    ui.error(error);
    uploading.value = false;
  }
}

async function queueUploaded() {
  if (!uploaded.value) return;
  try {
    await queue.enqueue(uploaded.value.id);
  } catch {
    /* toast already raised */
  }
}
</script>

<template>
  <div class="upload-page">
    <section class="section">
      <div class="section-head">
        <h2>Upload media</h2>
        <span class="sub">Accepted: {{ ACCEPT.replaceAll(',', ', ') }}</span>
      </div>

      <div
        class="dropzone"
        :class="{ dragging, busy: uploading }"
        role="button"
        tabindex="0"
        aria-label="Drop a media file here or press Enter to browse"
        @click="fileInput?.click()"
        @keydown.enter.prevent="fileInput?.click()"
        @keydown.space.prevent="fileInput?.click()"
        @dragover.prevent="dragging = true"
        @dragenter.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <span class="drop-icon" aria-hidden="true">↑</span>
        <p class="drop-main">Drag &amp; drop a track here</p>
        <p class="muted">or click to choose a file from this device</p>
        <input
          ref="fileInput"
          class="visually-hidden"
          type="file"
          :accept="ACCEPT"
          aria-label="Choose a media file to upload"
          @change="onPick"
        />
      </div>

      <div v-if="file" class="panel selected">
        <div class="selected-head">
          <div class="min">
            <p class="selected-name truncate" :title="file.name">{{ file.name }}</p>
            <p class="muted small">{{ formatBytes(file.size) }}</p>
          </div>
          <button class="btn btn-sm btn-ghost" type="button" :disabled="uploading" @click="reset">
            Remove
          </button>
        </div>

        <div class="fields">
          <div>
            <label for="up-title">Title (optional)</label>
            <input id="up-title" v-model="title" type="text" :disabled="uploading" />
          </div>
          <div>
            <label for="up-artist">Artist (optional)</label>
            <input id="up-artist" v-model="artist" type="text" :disabled="uploading" />
          </div>
        </div>

        <div v-if="uploading" class="progress">
          <div
            class="progress-track"
            role="progressbar"
            :aria-valuenow="progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="Upload progress"
          >
            <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
          </div>
          <span class="progress-label">{{ progress }}%</span>
        </div>

        <div class="row">
          <button class="btn btn-primary" type="button" :disabled="!canUpload" @click="submit">
            {{ uploading ? 'Uploading…' : 'Upload to jukebox' }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="uploaded" class="section">
      <div class="section-head">
        <h2>Upload complete</h2>
      </div>
      <div class="panel result">
        <ArtThumb class="result-art" :song="uploaded" size="120px" />
        <dl class="result-meta">
          <div><dt>Title</dt><dd>{{ uploaded.title || '—' }}</dd></div>
          <div><dt>Artist</dt><dd>{{ uploaded.artist || '—' }}</dd></div>
          <div><dt>Album</dt><dd>{{ uploaded.album || '—' }}</dd></div>
          <div><dt>Genre</dt><dd>{{ uploaded.genre || '—' }}</dd></div>
          <div><dt>Year</dt><dd>{{ uploaded.year || '—' }}</dd></div>
          <div><dt>Duration</dt><dd>{{ formatTime(uploaded.duration) }}</dd></div>
          <div><dt>Uploaded by</dt><dd>{{ uploaded.uploadedBy || '—' }}</dd></div>
        </dl>
        <div class="result-actions">
          <button class="btn btn-primary" type="button" @click="queueUploaded">Add to queue</button>
          <RouterLink class="btn" to="/library">Open library</RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.upload-page {
  max-width: 760px;
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  padding: 2.5rem 1rem;
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.dropzone:hover,
.dropzone.dragging {
  border-color: var(--accent);
  background: #131b1a;
}

.dropzone.busy {
  pointer-events: none;
  opacity: 0.6;
}

.drop-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--surface-3);
  font-size: 1.2rem;
  margin-bottom: 0.4rem;
}

.drop-main {
  margin: 0;
  font-weight: 600;
}

.small {
  font-size: 0.78rem;
}

.selected {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.selected-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.min {
  min-width: 0;
}

.selected-name {
  margin: 0;
  font-weight: 600;
}

.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.progress {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.progress-track {
  flex: 1;
  height: 6px;
  border-radius: 6px;
  background: var(--surface-3);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

.progress-label {
  font-size: 0.78rem;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}

.result {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 1.2rem;
  align-items: start;
}

.result-art {
  width: 120px;
  height: 120px;
}

.result-meta {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.6rem 1rem;
}

.result-meta dt {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.result-meta dd {
  margin: 0;
  font-size: 0.88rem;
  word-break: break-word;
}

.result-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .fields,
  .result {
    grid-template-columns: 1fr;
  }
}
</style>
