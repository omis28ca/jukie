<script setup>
import { onMounted } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();

onMounted(async () => {
  store.connectSocket();
  await store.fetchQueue();
});
</script>

<template>
  <section class="card">
    <h2>Now Playing</h2>
    <p v-if="store.player.nowPlaying">
      <strong>{{ store.player.nowPlaying.title }}</strong>
      <span v-if="store.player.nowPlaying.artist"> — {{ store.player.nowPlaying.artist }}</span>
    </p>
    <p v-else>No song playing.</p>
  </section>

  <section class="card">
    <h2>Queue</h2>
    <ol v-if="store.queue.length">
      <li v-for="item in store.queue" :key="item.id">
        {{ item.song.title }}
        <span v-if="item.song.artist"> — {{ item.song.artist }}</span>
        <small>({{ item.status }})</small>
      </li>
    </ol>
    <p v-else>The queue is empty.</p>
  </section>
</template>
