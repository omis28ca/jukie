<script setup>
import { computed, ref, watch } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();
const discoveryCommand = "mpv --audio-device=help --idle=yes --no-video --really-quiet";

const pin = computed({
  get: () => store.adminPin,
  set: (value) => store.setAdminPin(value)
});
const volume = ref(store.player.volume || 80);
const audioOutputDeviceId = ref(store.player.audioOutput?.deviceId || "auto");

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

function loadAudioOutputPreference() {
  store.fetchAudioOutputPreference();
}

function saveAudioOutputPreference() {
  store.saveAudioOutputPreference(audioOutputDeviceId.value);
}

async function copyDiscoveryCommand() {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(discoveryCommand);
      store.setStatus("Copied discovery command.");
      return;
    }
    throw new Error("Clipboard API unavailable");
  } catch {
    store.setError("Could not copy automatically. Copy the command manually from the help block.");
  }
}
</script>

<template>
  <section class="card">
    <h2>Admin Controls</h2>

    <p>
      <input class="input" v-model="pin" placeholder="Admin PIN" type="password" />
    </p>

    <p>
      <input class="progress-slider" v-model.number="volume" type="range" min="0" max="100" step="1" />
      <small> {{ volume }}% </small>
      <button class="button" @click="setVolume" :disabled="store.loading.admin">Set Volume</button>
    </p>

    <p><small>Current state: {{ store.player.state }} | Current volume: {{ store.player.volume }}</small></p>

    <p>
      <label for="audio-output-device"><small>Default Audio Output Device ID</small></label><br />
      <input id="audio-output-device" class="input" v-model="audioOutputDeviceId" placeholder="auto" type="text" />
    </p>

    <p>
      <button class="button" @click="loadAudioOutputPreference" :disabled="store.loading.admin">Load Output Preference</button>
      <button class="button" @click="saveAudioOutputPreference" :disabled="store.loading.admin">Save Output Preference</button>
    </p>

    <p>
      <small>
        Current output device: {{ store.player.audioOutput.deviceId }} |
        Apply status: {{ store.player.audioOutput.message || "No apply attempt yet." }}
      </small>
    </p>
    <p>
      <small>
        Tip: use <code>auto</code> for system default. If runtime apply is unsupported, set the OS default output device.
      </small>
    </p>
    <p>
      <small>
        Common examples: <code>auto</code>, <code>wasapi/{GUID}</code> (Windows), <code>pulse/&lt;name&gt;</code> (Linux PulseAudio),
        <code>alsa/&lt;name&gt;</code> (Linux ALSA), <code>coreaudio/&lt;name&gt;</code> (macOS).
      </small>
    </p>
    <p>
      <small>Use exact IDs recognized by your local mpv install.</small>
    </p>

    <details>
      <summary><small>How to find audio device IDs</small></summary>
      <p><small>Run one of these commands in a terminal on the machine running the server:</small></p>
      <p>
        <button class="button" @click="copyDiscoveryCommand" :disabled="store.loading.admin">Copy command</button>
      </p>
      <pre><code># Windows (PowerShell)
mpv --audio-device=help --idle=yes --no-video --really-quiet

# Linux
mpv --audio-device=help --idle=yes --no-video --really-quiet

# macOS
mpv --audio-device=help --idle=yes --no-video --really-quiet</code></pre>
      <p><small>Copy an ID from the output and paste it into the field above, then save.</small></p>
    </details>
  </section>
</template>
