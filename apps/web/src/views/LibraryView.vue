<script setup>
import { computed, onMounted, ref } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();
const requestedBy = ref("");
const query = ref("");

const filteredSongs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return store.songs;

  return store.songs.filter((song) => {
    const title = (song.title || "").toLowerCase();
    const artist = (song.artist || "").toLowerCase();
    return title.includes(needle) || artist.includes(needle);
  });
});

onMounted(() => {
  store.init();
  store.fetchSongs({ silent: true });
});

function add(songId) {
  store.addToQueue(songId, requestedBy.value);
}
</script>

<template>
  <section class="card">
    <h2>Library</h2>
    <p>
      <input class="input" v-model="requestedBy" placeholder="Your name, optional" />
    </p>
    <p>
      <input class="input" v-model="query" placeholder="Search title or artist" />
    </p>
    <button class="button" @click="store.fetchSongs" :disabled="store.loading.songs">Reload Library</button>
  </section>

  <section v-if="store.loading.songs" class="card">
    <p>Loading songs...</p>
  </section>

  <section class="card" v-for="song in filteredSongs" :key="song.id">
    <h3>{{ song.title }}</h3>
    <p v-if="song.artist">{{ song.artist }}</p>
    <button class="button" @click="add(song.id)" :disabled="store.loading.queueAdd">
      Add to Queue
    </button>
  </section>

  <section v-if="!store.loading.songs && !filteredSongs.length" class="card">
    <p>No songs found.</p>
  </section>
</template>
