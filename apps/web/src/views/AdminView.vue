<script setup>
import { computed, onMounted, ref } from 'vue';
import ArtThumb from '../components/ArtThumb.vue';
import { api } from '../lib/api';
import { useSessionStore } from '../stores/session';
import { usePlayerStore } from '../stores/player';
import { useQueueStore } from '../stores/queue';
import { useLibraryStore } from '../stores/library';
import { useMoodsStore } from '../stores/moods';
import { useUiStore } from '../stores/ui';
import { formatTime } from '../lib/format';

const session = useSessionStore();
const player = usePlayerStore();
const queue = useQueueStore();
const library = useLibraryStore();
const moods = useMoodsStore();
const ui = useUiStore();

const pin = ref('');
const pinError = ref('');

const newMoodName = ref('');
const renamingId = ref('');
const renameValue = ref('');
const moodBusy = ref('');

const historyMoodName = ref('');
const historySelection = ref(new Set());

const historyEntries = computed(() => queue.history);
const selectedHistoryCount = computed(() => historySelection.value.size);

const outputs = ref([]);
const selectedOutput = ref('');
const outputMessage = ref('');
const outputApplied = ref(false);
const outputLoading = ref(false);

const songFilter = ref('');

const storage = ref(null);
const storageRootInput = ref('');
const storageMove = ref(true);
const storageLoading = ref(false);

const isAdmin = computed(() => session.isAdmin);

const storageVolumes = computed(() => storage.value?.volumes ?? []);
const storageChanged = computed(
  () => Boolean(storageRootInput.value.trim()) && storageRootInput.value.trim() !== storage.value?.root
);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const filteredSongs = computed(() => {
  const term = songFilter.value.trim().toLowerCase();
  if (!term) return library.songs;
  return library.songs.filter((song) =>
    [song.title, song.artist, song.album, song.genre, song.uploadedBy]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(term))
  );
});

onMounted(async () => {
  if (!library.loaded) library.fetch();
  if (!moods.loaded) moods.fetch();
  if (session.pin && !session.isAdmin) await session.restoreAdmin();
  if (session.isAdmin) {
    await loadOutputs();
    await loadHistory();
    await loadStorage();
  }
});

async function loadStorage() {
  storageLoading.value = true;
  try {
    storage.value = await api.get('/api/admin/storage/location');
    storageRootInput.value = storage.value?.root || '';
  } catch (error) {
    ui.error(error);
  } finally {
    storageLoading.value = false;
  }
}

/** Repoints the library at another drive; `move` also relocates the files already stored. */
async function saveStorageRoot({ useDefault = false } = {}) {
  const root = storageRootInput.value.trim();
  if (!useDefault && !root) {
    ui.error('Enter the folder that should hold the music');
    return;
  }
  if (
    storageMove.value &&
    !window.confirm('Move the existing music, artwork and pending imports to the new location?')
  ) {
    return;
  }

  storageLoading.value = true;
  try {
    const payload = await api.post('/api/admin/storage/location', {
      root: useDefault ? undefined : root,
      useDefault,
      move: storageMove.value
    });
    storage.value = payload;
    storageRootInput.value = payload?.root || root;
    ui.success(
      payload?.movedCount
        ? `Music storage moved to ${payload.root} (${payload.movedCount} items)`
        : `Music storage set to ${payload?.root || root}`
    );
    await library.fetch();
  } catch (error) {
    ui.error(error);
  } finally {
    storageLoading.value = false;
  }
}

function resetHistorySelection() {
  historySelection.value = new Set(queue.history.map((entry) => entry.song?.id).filter(Boolean));
}

async function loadHistory() {
  try {
    await queue.fetchHistory(50);
    resetHistorySelection();
  } catch {
    /* toast already raised */
  }
}

function toggleHistory(songId) {
  if (!songId) return;
  const next = new Set(historySelection.value);
  if (next.has(songId)) next.delete(songId);
  else next.add(songId);
  historySelection.value = next;
}

/** Saves the checked tracks in the order the room heard them (oldest first). */
async function saveHistoryMood() {
  const name = historyMoodName.value.trim();
  if (!name) {
    ui.error('Give the mood a name first');
    return;
  }

  const songIds = [
    ...new Set(
      [...queue.history]
        .reverse()
        .map((entry) => entry.song?.id)
        .filter((songId) => songId && historySelection.value.has(songId))
    )
  ];

  if (!songIds.length) {
    ui.error('Pick at least one played track');
    return;
  }

  moodBusy.value = 'history';
  try {
    await moods.createFromHistory(name, { songIds });
    historyMoodName.value = '';
  } catch {
    /* toast already raised */
  } finally {
    moodBusy.value = '';
  }
}

async function submitPin() {
  pinError.value = '';
  const value = pin.value.trim();
  if (!/^\d{4}$/.test(value)) {
    pinError.value = 'Enter the 4-digit admin PIN.';
    return;
  }
  try {
    await session.validatePin(value);
    ui.success('Admin unlocked');
    pin.value = '';
    await loadOutputs();
    await loadHistory();
    await loadStorage();
  } catch (error) {
    pinError.value = error?.message || 'That PIN was rejected.';
  }
}

function lock() {
  session.signOutAdmin();
  outputs.value = [];
  ui.info('Admin locked');
}

async function loadOutputs() {
  outputLoading.value = true;
  try {
    const payload = await api.get('/api/admin/settings/audio-output');
    outputs.value = Array.isArray(payload?.devices) ? payload.devices : [];
    selectedOutput.value = payload?.deviceId ?? '';
    outputApplied.value = Boolean(payload?.applied);
    outputMessage.value = payload?.message || '';
  } catch (error) {
    ui.error(error);
  } finally {
    outputLoading.value = false;
  }
}

async function saveOutput() {
  outputLoading.value = true;
  try {
    const payload = await api.post('/api/admin/settings/audio-output', {
      deviceId: selectedOutput.value
    });
    outputs.value = Array.isArray(payload?.devices) ? payload.devices : outputs.value;
    selectedOutput.value = payload?.deviceId ?? selectedOutput.value;
    outputApplied.value = Boolean(payload?.applied);
    outputMessage.value = payload?.message || '';
    ui.success(payload?.message || 'Audio output updated');
  } catch (error) {
    ui.error(error);
  } finally {
    outputLoading.value = false;
  }
}

function onVolume(event) {
  player.setVolume(Number(event.target.value)).catch(() => {});
}

async function clearQueue() {
  if (!window.confirm('Clear every queued song?')) return;
  await queue.clear().catch(() => {});
}

async function createMood() {
  const name = newMoodName.value.trim();
  if (!name) {
    ui.error('Give the mood a name first');
    return;
  }
  moodBusy.value = 'create';
  try {
    await moods.create(name);
    newMoodName.value = '';
  } catch {
    /* toast already raised */
  } finally {
    moodBusy.value = '';
  }
}

function startRename(mood) {
  renamingId.value = mood.id;
  renameValue.value = mood.name;
}

async function commitRename(mood) {
  const name = renameValue.value.trim();
  if (!name || name === mood.name) {
    renamingId.value = '';
    return;
  }
  moodBusy.value = mood.id;
  try {
    await moods.rename(mood.id, name);
    renamingId.value = '';
  } catch {
    /* toast already raised */
  } finally {
    moodBusy.value = '';
  }
}

async function deleteMood(mood) {
  if (!window.confirm(`Delete the mood “${mood.name}”?`)) return;
  moodBusy.value = mood.id;
  try {
    await moods.remove(mood.id);
  } catch {
    /* toast already raised */
  } finally {
    moodBusy.value = '';
  }
}

async function selectMood(mood) {
  moodBusy.value = mood.id;
  try {
    await moods.select(mood.id);
  } catch {
    /* toast already raised */
  } finally {
    moodBusy.value = '';
  }
}

async function deleteSong(song) {
  if (!window.confirm(`Delete “${song.title}” and its stored files?`)) return;
  await library.deleteSong(song.id).catch(() => {});
}
</script>

<template>
  <div class="admin">
    <!-- PIN gate -->
    <section class="section">
      <div class="panel pin-panel">
        <div class="pin-head">
          <h2>Admin access</h2>
          <span class="badge" :class="{ 'badge-accent': isAdmin }">
            {{ isAdmin ? 'Unlocked' : 'Locked' }}
          </span>
        </div>

        <form v-if="!isAdmin" class="pin-form" @submit.prevent="submitPin">
          <div class="pin-field">
            <label for="admin-pin">4-digit PIN</label>
            <input
              id="admin-pin"
              v-model="pin"
              type="password"
              inputmode="numeric"
              autocomplete="off"
              maxlength="4"
              placeholder="••••"
              :aria-invalid="Boolean(pinError)"
              aria-describedby="pin-error"
              @input="pinError = ''"
            />
          </div>
          <button class="btn btn-primary" type="submit" :disabled="session.validating">
            {{ session.validating ? 'Checking…' : 'Unlock' }}
          </button>
        </form>
        <p v-if="pinError" id="pin-error" class="pin-error">{{ pinError }}</p>
        <p v-if="!isAdmin" class="muted small">
          Admin controls stay disabled until the PIN is verified by the server.
        </p>

        <div v-else class="row">
          <p class="muted small min">The PIN is stored on this device and sent with every request.</p>
          <button class="btn btn-sm" type="button" @click="lock">Lock admin</button>
        </div>
      </div>
    </section>

    <fieldset class="admin-body" :disabled="!isAdmin">
      <!-- Playback -->
      <section class="section">
        <div class="section-head"><h2>Playback</h2></div>
        <div class="panel stack">
          <div class="vol-row">
            <label for="admin-volume">Room volume — {{ player.volume }}%</label>
            <input
              id="admin-volume"
              type="range"
              min="0"
              max="100"
              step="1"
              :value="player.volume"
              :aria-valuetext="`${player.volume} percent`"
              @input="onVolume"
            />
          </div>

          <div class="row">
            <button class="btn" type="button" @click="player.start()">Start queue</button>
            <button class="btn" type="button" @click="player.stop()">Stop queue</button>
            <button class="btn" type="button" @click="player.skip()">Skip track</button>
            <button class="btn" type="button" @click="player.toggleLoop()">
              Loop {{ player.loopQueue ? 'on' : 'off' }}
            </button>
            <button class="btn btn-danger" type="button" @click="clearQueue">
              Clear queue ({{ queue.count }})
            </button>
          </div>

          <p class="muted small">
            Player state: <strong>{{ player.state }}</strong> ·
            {{ player.queueStopped ? 'queue stopped' : 'queue running' }} ·
            {{ formatTime(player.positionSeconds) }} elapsed
          </p>
        </div>
      </section>

      <!-- Audio output -->
      <section class="section">
        <div class="section-head">
          <h2>Audio output</h2>
          <button class="btn btn-sm" type="button" :disabled="outputLoading" @click="loadOutputs">
            Refresh devices
          </button>
        </div>
        <div class="panel stack">
          <div>
            <label for="audio-output">Output device</label>
            <select id="audio-output" v-model="selectedOutput" :disabled="outputLoading">
              <option value="">System default</option>
              <option v-for="device in outputs" :key="device.id" :value="device.id">
                {{ device.name || device.id }}
              </option>
            </select>
          </div>
          <div class="row">
            <button class="btn btn-primary" type="button" :disabled="outputLoading" @click="saveOutput">
              {{ outputLoading ? 'Applying…' : 'Apply output' }}
            </button>
            <span v-if="outputMessage" class="badge" :class="{ 'badge-accent': outputApplied }">
              {{ outputMessage }}
            </span>
          </div>
          <p v-if="!outputs.length && !outputLoading" class="muted small">
            No devices reported by the server yet.
          </p>
        </div>
      </section>

      <!-- Moods -->
      <section class="section">
        <div class="section-head">
          <h2>Moods</h2>
          <span class="sub">{{ moods.moods.length }} playlists</span>
        </div>

        <div class="panel stack">
          <form class="row" @submit.prevent="createMood">
            <div class="min grow">
              <label class="visually-hidden" for="new-mood">New mood name</label>
              <input id="new-mood" v-model="newMoodName" type="text" placeholder="New mood name…" />
            </div>
            <button class="btn btn-primary" type="submit" :disabled="moodBusy === 'create'">
              Create mood
            </button>
          </form>

          <ul v-if="moods.moods.length" class="mood-list">
            <li v-for="mood in moods.moods" :key="mood.id" class="mood-row">
              <template v-if="renamingId === mood.id">
                <label class="visually-hidden" :for="`rename-${mood.id}`">Rename {{ mood.name }}</label>
                <input
                  :id="`rename-${mood.id}`"
                  v-model="renameValue"
                  type="text"
                  class="rename-input"
                  @keyup.enter="commitRename(mood)"
                  @keyup.esc="renamingId = ''"
                />
                <div class="mood-actions">
                  <button class="btn btn-sm btn-primary" type="button" @click="commitRename(mood)">
                    Save
                  </button>
                  <button class="btn btn-sm btn-ghost" type="button" @click="renamingId = ''">
                    Cancel
                  </button>
                </div>
              </template>
              <template v-else>
                <div class="min">
                  <span class="mood-name truncate">{{ mood.name }}</span>
                  <span class="muted small">{{ mood.songCount || 0 }} songs</span>
                </div>
                <div class="mood-actions">
                  <button
                    class="btn btn-sm"
                    type="button"
                    :disabled="moodBusy === mood.id"
                    :aria-label="`Select the ${mood.name} mood`"
                    @click="selectMood(mood)"
                  >
                    Select
                  </button>
                  <button
                    class="btn btn-sm"
                    type="button"
                    :aria-label="`Rename the ${mood.name} mood`"
                    @click="startRename(mood)"
                  >
                    Rename
                  </button>
                  <button
                    class="btn btn-sm btn-danger"
                    type="button"
                    :disabled="moodBusy === mood.id"
                    :aria-label="`Delete the ${mood.name} mood`"
                    @click="deleteMood(mood)"
                  >
                    Delete
                  </button>
                </div>
              </template>
            </li>
          </ul>
          <p v-else class="muted small">No moods yet.</p>
        </div>
      </section>

      <!-- Mood from playback history -->
      <section class="section">
        <div class="section-head">
          <h2>Save a mood from what was played</h2>
          <button
            class="btn btn-sm"
            type="button"
            :disabled="queue.historyLoading"
            @click="loadHistory"
          >
            {{ queue.historyLoading ? 'Refreshing…' : 'Refresh history' }}
          </button>
        </div>

        <div class="panel stack">
          <p class="muted small">
            Tick the tracks the room actually enjoyed and save them as a playlist. They are stored in
            the order they were played, and repeats are saved once.
          </p>

          <form class="row" @submit.prevent="saveHistoryMood">
            <div class="min grow">
              <label class="visually-hidden" for="history-mood">Name for the new mood</label>
              <input
                id="history-mood"
                v-model="historyMoodName"
                type="text"
                placeholder="e.g. Friday night set…"
              />
            </div>
            <button
              class="btn btn-primary"
              type="submit"
              :disabled="moodBusy === 'history' || !selectedHistoryCount"
            >
              {{ moodBusy === 'history' ? 'Saving…' : `Save ${selectedHistoryCount} as mood` }}
            </button>
          </form>

          <div v-if="historyEntries.length" class="row">
            <button class="btn btn-sm btn-ghost" type="button" @click="resetHistorySelection">
              Select all
            </button>
            <button
              class="btn btn-sm btn-ghost"
              type="button"
              @click="historySelection = new Set()"
            >
              Clear selection
            </button>
          </div>

          <ul v-if="historyEntries.length" class="song-list">
            <li v-for="entry in historyEntries" :key="entry.id" class="song-row">
              <input
                :id="`history-${entry.id}`"
                class="history-check"
                type="checkbox"
                :checked="historySelection.has(entry.song?.id)"
                :aria-label="`Include ${entry.song?.title} in the new mood`"
                @change="toggleHistory(entry.song?.id)"
              />
              <ArtThumb class="song-art" :song="entry.song" size="40px" />
              <label class="min history-label" :for="`history-${entry.id}`">
                <span class="song-title truncate">{{ entry.song?.title }}</span>
                <span class="muted small truncate">
                  {{ entry.song?.artist || 'Unknown artist' }} ·
                  {{ entry.status === 'skipped' ? 'skipped' : 'played' }}
                  <template v-if="entry.requestedBy"> · by {{ entry.requestedBy }}</template>
                </span>
              </label>
            </li>
          </ul>
          <p v-else-if="queue.historyLoading" class="muted small">Loading history…</p>
          <p v-else class="muted small">
            Nothing has finished playing yet — the history fills up as the queue plays.
          </p>
        </div>
      </section>

      <!-- Music storage drive -->
      <section class="section">
        <div class="section-head">
          <h2>Music storage drive</h2>
          <button class="btn btn-sm" type="button" :disabled="storageLoading" @click="loadStorage">
            Refresh
          </button>
        </div>

        <div class="panel stack">
          <div class="storage-now">
            <p class="storage-path">{{ storage?.root || '—' }}</p>
            <p class="muted small">
              <template v-if="storage">
                {{ storage.source === 'setting' ? 'Set from this panel' : 'From the server configuration' }}
                <template v-if="storage.disk?.freeBytes != null">
                  · {{ formatBytes(storage.disk.freeBytes) }} free of
                  {{ formatBytes(storage.disk.totalBytes) }}
                </template>
              </template>
              <template v-else>Loading…</template>
            </p>
            <p v-if="storage" class="muted small">
              Uploads: {{ storage.uploadDir }} · Artwork: {{ storage.artworkDir }} · Drop folder:
              {{ storage.importDir }}
            </p>
          </div>

          <div v-if="storageVolumes.length">
            <label for="storage-volume">Detected drives</label>
            <select
              id="storage-volume"
              :disabled="storageLoading"
              @change="storageRootInput = $event.target.value"
            >
              <option value="">Choose a drive…</option>
              <option v-for="volume in storageVolumes" :key="volume.path" :value="volume.suggestedRoot">
                {{ volume.path }}
                <template v-if="volume.freeBytes != null"> — {{ formatBytes(volume.freeBytes) }} free</template>
                <template v-if="!volume.writable"> (read-only)</template>
              </option>
            </select>
          </div>

          <div>
            <label for="storage-root">Music folder</label>
            <input
              id="storage-root"
              v-model="storageRootInput"
              type="text"
              spellcheck="false"
              placeholder="/mnt/music or D:\jukie-music"
            />
            <p class="muted small">
              Jukie creates <code>uploads</code>, <code>artwork</code> and <code>imports</code> inside this
              folder.
            </p>
          </div>

          <label class="storage-check">
            <input v-model="storageMove" type="checkbox" :disabled="storageLoading" />
            <span>Move the existing library to the new drive (stop playback first)</span>
          </label>

          <div class="row">
            <button
              class="btn btn-primary"
              type="button"
              :disabled="storageLoading || !storageChanged"
              @click="saveStorageRoot()"
            >
              {{ storageLoading ? 'Working…' : 'Use this folder' }}
            </button>
            <button
              class="btn btn-sm"
              type="button"
              :disabled="storageLoading || storage?.isDefault"
              @click="saveStorageRoot({ useDefault: true })"
            >
              Reset to default
            </button>
          </div>
        </div>
      </section>

      <!-- Storage / library -->
      <section class="section">
        <div class="section-head">
          <h2>Storage &amp; library</h2>
          <span class="sub">{{ library.songs.length }} songs stored</span>
        </div>

        <div class="panel stack">
          <div>
            <label class="visually-hidden" for="song-filter">Filter stored songs</label>
            <input
              id="song-filter"
              v-model="songFilter"
              type="search"
              placeholder="Filter stored songs…"
            />
          </div>

          <ul v-if="filteredSongs.length" class="song-list">
            <li v-for="song in filteredSongs" :key="song.id" class="song-row">
              <ArtThumb class="song-art" :song="song" size="40px" />
              <div class="min">
                <span class="song-title truncate">{{ song.title }}</span>
                <span class="muted small truncate">
                  {{ song.artist || 'Unknown artist' }} · {{ formatTime(song.duration) }}
                  <template v-if="song.uploadedBy"> · by {{ song.uploadedBy }}</template>
                </span>
              </div>
              <button
                class="btn btn-sm btn-danger"
                type="button"
                :aria-label="`Delete ${song.title} from storage`"
                @click="deleteSong(song)"
              >
                Delete
              </button>
            </li>
          </ul>
          <p v-else class="muted small">No songs match that filter.</p>
        </div>
      </section>
    </fieldset>
  </div>
</template>

<style scoped>
.admin {
  max-width: 900px;
}

.admin-body {
  border: none;
  margin: 0;
  padding: 0;
  min-width: 0;
}

.admin-body:disabled {
  opacity: 0.45;
}

.pin-panel {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.pin-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.pin-form {
  display: flex;
  align-items: flex-end;
  gap: 0.6rem;
}

.pin-field {
  width: 160px;
}

.pin-field input {
  letter-spacing: 0.4em;
  text-align: center;
  font-size: 1.1rem;
}

.pin-error {
  margin: 0;
  color: var(--danger);
  font-size: 0.82rem;
}

.small {
  font-size: 0.79rem;
}

.min {
  min-width: 0;
}

.grow {
  flex: 1;
}

.vol-row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.mood-list,
.song-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 420px;
  overflow-y: auto;
}

.mood-row,
.song-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.45rem 0.55rem;
  border-radius: var(--radius-sm);
}

.mood-row:hover,
.song-row:hover {
  background: var(--surface-2);
}

.mood-row .min,
.song-row .min {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.mood-name,
.song-title {
  font-size: 0.89rem;
  font-weight: 600;
}

.mood-actions {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.rename-input {
  flex: 1;
}

.song-art {
  width: 40px;
  height: 40px;
  flex: none;
}

.history-check {
  width: 1.05rem;
  height: 1.05rem;
  flex: none;
  accent-color: var(--accent);
}

.storage-now {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.storage-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.95rem;
  word-break: break-all;
}

.storage-check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.storage-check input {
  width: 1.05rem;
  height: 1.05rem;
  accent-color: var(--accent);
}

.history-label {
  flex: 1;
  display: flex;
  flex-direction: column;
  cursor: pointer;
}

@media (max-width: 640px) {
  .pin-form {
    flex-direction: column;
    align-items: stretch;
  }

  .pin-field {
    width: 100%;
  }

  .mood-row,
  .song-row {
    flex-wrap: wrap;
  }
}
</style>
