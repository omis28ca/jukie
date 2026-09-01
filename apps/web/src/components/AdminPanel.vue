<script setup>
import { computed, ref, watch } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();
const volume = ref(store.player.volume ?? 80);
const audioOutputDeviceId = ref(store.player.audioOutput?.deviceId || "auto");
const advancedOpen = ref(false);
const moodName = ref("");
const selectedMoodSongIds = ref([]);
const pinReady = computed(() => /^\d{4}$/.test(store.adminPin));

watch(() => store.player.volume, (value) => {
  if (Number.isFinite(value)) volume.value = value;
});
watch(() => store.player.audioOutput?.deviceId, (value) => {
  if (typeof value === "string" && value.trim()) audioOutputDeviceId.value = value;
});

function setVolume() {
  store.adminAction("/api/player/volume", { volume: volume.value });
}

function authorizeAdmin() {
  store.requestAdminPin({ forcePrompt: true });
}

function logoutAdmin() {
  store.clearAdminPin();
  store.setStatus("Admin authorization removed from this device.");
}

function toggleMoodSong(songId) {
  selectedMoodSongIds.value = selectedMoodSongIds.value.includes(songId)
    ? selectedMoodSongIds.value.filter((id) => id !== songId)
    : [...selectedMoodSongIds.value, songId];
}

async function createMood() {
  const mood = await store.createMood(moodName.value, selectedMoodSongIds.value);
  if (!mood) return;
  moodName.value = "";
  selectedMoodSongIds.value = [];
}

function deleteMood(mood) {
  if (!window.confirm(`Delete the “${mood.name}” mood?`)) return;
  store.deleteMood(mood.id);
}
</script>

<template>
  <div class="admin-page-content">
    <section class="admin-intro" :class="{ ready: pinReady }">
      <span class="admin-lock" aria-hidden="true">{{ pinReady ? "✓" : "⌁" }}</span>
      <div><h2>{{ pinReady ? "Admin controls unlocked" : "Admin controls locked" }}</h2><p>{{ pinReady ? "Protected room controls are authorized on this device." : "Admin actions will prompt for your four-digit PIN keypad." }}</p></div>
      <div class="admin-access-actions">
        <button class="button button-primary" type="button" @click="authorizeAdmin">{{ pinReady ? "Change PIN" : "Authorize" }}</button>
        <button v-if="pinReady" class="button button-secondary" type="button" @click="logoutAdmin">Log out</button>
      </div>
    </section>

    <div class="admin-grid">
      <section class="mobile-settings-card">
        <header><span class="settings-icon" aria-hidden="true">▶</span><div><h3>Room playback</h3><p>Start or stop the shared player.</p></div><span class="state-chip">{{ store.player.state }}</span></header>
        <div class="transport-admin">
          <button class="button button-primary" type="button" :disabled="store.loading.admin || store.player.state !== 'idle'" @click="store.adminAction('/api/player/start')">▶ Start queue</button>
          <button class="button button-secondary" type="button" :disabled="store.loading.admin || !store.player.nowPlaying" @click="store.adminAction('/api/player/stop')">■ Stop playback</button>
        </div>
      </section>

      <section class="mobile-settings-card">
        <header><span class="settings-icon" aria-hidden="true">◖</span><div><h3>Room volume</h3><p>Changes the speakers connected to the server.</p></div><strong class="volume-value">{{ volume }}%</strong></header>
        <input v-model.number="volume" class="touch-range" type="range" min="0" max="100" step="1" aria-label="Room volume" />
        <button class="button button-primary button-wide" type="button" :disabled="store.loading.admin" @click="setVolume">Apply volume</button>
      </section>

      <section class="mobile-settings-card danger-card">
        <header><span class="settings-icon" aria-hidden="true">☷</span><div><h3>Queue maintenance</h3><p>Remove all upcoming songs without interrupting the current track.</p></div></header>
        <button class="button button-danger button-wide" type="button" :disabled="store.loading.admin || !store.queuedItems.length" @click="store.clearQueue()">Clear {{ store.queuedItems.length }} upcoming track(s)</button>
      </section>

      <section class="mobile-settings-card mood-admin-card">
        <header><span class="settings-icon" aria-hidden="true">♫</span><div><h3>Moods</h3><p>Create playlists anyone can load into the queue.</p></div><span class="state-chip">{{ store.moods.length }}</span></header>
        <div v-if="store.moods.length" class="admin-mood-list">
          <div v-for="mood in store.moods" :key="mood.id">
            <span><strong>{{ mood.name }}</strong><small>{{ mood.songs.length }} song(s)</small></span>
            <button type="button" :disabled="store.loading.admin" :aria-label="`Delete ${mood.name}`" @click="deleteMood(mood)">×</button>
          </div>
        </div>
        <label class="field"><span>Mood name</span><input v-model="moodName" class="input" maxlength="80" placeholder="Friday energy" /></label>
        <fieldset class="mood-song-picker">
          <legend>Playlist songs in this order</legend>
          <button
            v-for="song in store.songs"
            :key="song.id"
            type="button"
            :class="{ selected: selectedMoodSongIds.includes(song.id) }"
            @click="toggleMoodSong(song.id)"
          >
            <span>{{ selectedMoodSongIds.indexOf(song.id) + 1 || "" }}</span>
            <span><strong>{{ song.title }}</strong><small>{{ song.artist || "Unknown artist" }}</small></span>
          </button>
        </fieldset>
        <button class="button button-primary button-wide" type="button" :disabled="store.loading.admin || !moodName.trim() || !selectedMoodSongIds.length" @click="createMood">Create mood with {{ selectedMoodSongIds.length }} song(s)</button>
      </section>

      <section class="mobile-settings-card advanced-card">
        <button class="advanced-toggle" type="button" @click="advancedOpen = !advancedOpen"><span class="settings-icon" aria-hidden="true">⚙</span><span><strong>Advanced audio output</strong><small>Choose the mpv output device</small></span><b>{{ advancedOpen ? "⌃" : "⌄" }}</b></button>
        <div v-if="advancedOpen" class="advanced-content">
          <label class="field"><span>mpv audio device ID</span><input v-model="audioOutputDeviceId" class="input" placeholder="auto" /></label>
          <p class="field-help">Use <code>auto</code> or an exact device ID recognized by mpv on the server.</p>
          <div class="button-row"><button class="button button-secondary" type="button" :disabled="store.loading.admin" @click="store.fetchAudioOutputPreference()">Reload</button><button class="button button-primary" type="button" :disabled="store.loading.admin" @click="store.saveAudioOutputPreference(audioOutputDeviceId)">Save output</button></div>
          <p v-if="store.player.audioOutput.message" class="inline-message">{{ store.player.audioOutput.message }}</p>
          <details class="command-help"><summary>How to find device IDs</summary><p>Run on the jukebox host:</p><code>mpv --audio-device=help --idle=yes --no-video</code></details>
        </div>
      </section>
    </div>

    <p v-if="!pinReady" class="locked-hint">Protected actions will open the PIN keypad automatically.</p>
  </div>
</template>
