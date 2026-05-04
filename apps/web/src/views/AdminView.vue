<script setup>
import { computed, ref } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();

const pin = computed({
  get: () => store.adminPin,
  set: (value) => store.setAdminPin(value)
});
const volume = ref(store.player.volume || 80);

function skip() {
  store.adminAction("/api/player/skip");
}

function pause() {
  store.adminAction("/api/player/pause");
}

function resume() {
  store.adminAction("/api/player/resume");
}

function setVolume() {
  store.adminAction("/api/player/volume", { volume: volume.value });
}

function clearQueue() {
  store.clearQueue();
}
</script>

<template>
  <section class="card">
    <h2>Admin Controls</h2>

    <p>
      <input class="input" v-model="pin" placeholder="Admin PIN" type="password" />
    </p>

    <p>
      <button class="button" @click="skip" :disabled="store.loading.admin">Skip</button>
      <button class="button" @click="pause" :disabled="store.loading.admin">Pause</button>
      <button class="button" @click="resume" :disabled="store.loading.admin">Resume</button>
      <button class="button button-danger" @click="clearQueue" :disabled="store.loading.admin">Clear Queue</button>
    </p>

    <p>
      <input class="input" v-model.number="volume" type="number" min="0" max="100" />
      <button class="button" @click="setVolume" :disabled="store.loading.admin">Set Volume</button>
    </p>

    <p><small>Current state: {{ store.player.state }} | Current volume: {{ store.player.volume }}</small></p>
  </section>
</template>
