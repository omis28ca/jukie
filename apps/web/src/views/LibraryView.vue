<script setup>
import { onMounted, ref } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();
const requestedBy = ref("");

onMounted(async () => {
  store.connectSocket();
  await store.fetchSongs();
});
</script>

<template>
  <section class="card">
    <h2>Library</h2>
    <input class="input" v-model="requestedBy" placeholder="Your name, optional" />
  </section>

  <section class="card" v-for="song in store.songs" :key="song.id">
    <h3>{{ song.title }}</h3>
    <p v-if="song.artist">{{ song.artist }}</p>
    <button class="button" @click="store.addToQueue(song.id, requestedBy)">
      Add to Queue
    </button>
  </section>
</template>
