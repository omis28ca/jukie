<script setup>
import { computed, ref } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();

const pin = computed({
  get: () => store.adminPin,
  set: (value) => store.setAdminPin(value)
});
const volume = ref(store.player.volume || 80);

function setVolume() {
  store.adminAction("/api/player/volume", { volume: volume.value });
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
  </section>
</template>
