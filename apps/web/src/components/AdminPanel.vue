<script setup>
import { computed, ref, watch } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();
const discoveryCommand = "mpv --audio-device=help --idle=yes --no-video --really-quiet";
const volume = ref(store.player.volume ?? 80);
const audioOutputDeviceId = ref(store.player.audioOutput?.deviceId || "auto");

const pin = computed({
  get: () => store.adminPin,
  set: (value) => store.setAdminPin(value)
});

watch(
  () => store.player.volume,
  (nextVolume) => {
    if (Number.isFinite(nextVolume)) volume.value = nextVolume;
  }
);

watch(
  () => store.player.audioOutput?.deviceId,
  (nextDeviceId) => {
    if (typeof nextDeviceId === "string" && nextDeviceId.trim()) {
      audioOutputDeviceId.value = nextDeviceId;
    }
  }
);

function setVolume() {
  store.adminAction("/api/player/volume", { volume: volume.value });
}

async function copyDiscoveryCommand() {
  if (!navigator?.clipboard?.writeText) {
    store.setError("Could not copy automatically. Select the command below to copy it.");
    return;
  }

  try {
    await navigator.clipboard.writeText(discoveryCommand);
    store.setStatus("Copied audio-device discovery command.");
  } catch {
    store.setError("Could not copy automatically. Select the command below to copy it.");
  }
}
</script>

<template>
  <div class="settings-stack">
    <section class="settings-section">
      <div class="section-heading compact-heading">
        <div>
          <span class="eyebrow">Access</span>
          <h3>Admin session</h3>
        </div>
        <span class="status-pill" :class="store.adminPin ? 'is-ready' : ''">
          {{ store.adminPin ? "PIN saved" : "PIN required" }}
        </span>
      </div>
      <label class="field">
        <span>Admin PIN</span>
        <input v-model="pin" class="input" type="password" autocomplete="off" placeholder="Enter server PIN" />
      </label>
      <p class="field-help">Saved only in this browser and sent with protected playback and library actions.</p>
    </section>

    <section class="settings-section">
      <div class="section-heading compact-heading">
        <div>
          <span class="eyebrow">Playback</span>
          <h3>Room volume</h3>
        </div>
        <strong class="volume-readout">{{ volume }}%</strong>
      </div>
      <input v-model.number="volume" class="range" type="range" min="0" max="100" step="1" aria-label="Room volume" />
      <div class="settings-actions">
        <span class="field-help">Server reports {{ store.player.volume }}%</span>
        <button class="button button-secondary" type="button" :disabled="store.loading.admin" @click="setVolume">
          Apply volume
        </button>
      </div>
    </section>

    <section class="settings-section">
      <div class="section-heading compact-heading">
        <div>
          <span class="eyebrow">Audio engine</span>
          <h3>Output device</h3>
        </div>
        <span
          class="status-pill"
          :class="store.player.audioOutput.applied === true ? 'is-ready' : store.player.audioOutput.applied === false ? 'is-error' : ''"
        >
          {{ store.player.audioOutput.applied === true ? "Applied" : store.player.audioOutput.applied === false ? "Needs attention" : "Not tested" }}
        </span>
      </div>
      <label class="field">
        <span>mpv audio device ID</span>
        <input v-model="audioOutputDeviceId" class="input" placeholder="auto" />
      </label>
      <p class="field-help">Use <code>auto</code>, <code>wasapi/{GUID}</code>, <code>pulse/&lt;name&gt;</code>, or another exact ID recognized by mpv.</p>
      <div class="settings-actions settings-actions-left">
        <button class="button button-secondary" type="button" :disabled="store.loading.admin" @click="store.fetchAudioOutputPreference()">
          Reload saved
        </button>
        <button class="button button-primary" type="button" :disabled="store.loading.admin" @click="store.saveAudioOutputPreference(audioOutputDeviceId)">
          Save output
        </button>
      </div>
      <p v-if="store.player.audioOutput.message" class="output-message">{{ store.player.audioOutput.message }}</p>

      <details class="help-disclosure">
        <summary>Find available audio device IDs</summary>
        <p>Run this command on the machine hosting the jukebox server:</p>
        <pre><code>{{ discoveryCommand }}</code></pre>
        <button class="button button-quiet" type="button" @click="copyDiscoveryCommand">Copy command</button>
      </details>
    </section>
  </div>
</template>

