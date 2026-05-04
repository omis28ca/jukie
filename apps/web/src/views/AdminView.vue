<script setup>
import { ref } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();

const pin = ref("");
const volume = ref(80);

function skip() {
  store.adminAction("/api/player/skip", null, pin.value);
}

function pause() {
  store.adminAction("/api/player/pause", null, pin.value);
}

function resume() {
  store.adminAction("/api/player/resume", null, pin.value);
}

function setVolume() {
  store.adminAction("/api/player/volume", { volume: volume.value }, pin.value);
}
</script>

<template>
  <section class="card">
    <h2>Admin Controls</h2>

    <p>
      <input class="input" v-model="pin" placeholder="Admin PIN" type="password" />
    </p>

    <p>
      <button class="button" @click="skip">Skip</button>
      <button class="button" @click="pause">Pause</button>
      <button class="button" @click="resume">Resume</button>
    </p>

    <p>
      <input class="input" v-model.number="volume" type="number" min="0" max="100" />
      <button class="button" @click="setVolume">Set Volume</button>
    </p>
  </section>
</template>
