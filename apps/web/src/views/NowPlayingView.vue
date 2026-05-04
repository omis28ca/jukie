<script setup>
import { computed, onMounted } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();
const queuedItems = computed(() => store.queuedItems);

onMounted(() => {
  store.init();
  store.refreshRealtime();
});
</script>

<template>
  <section class="card">
    <h2>Now Playing</h2>
    <p><small>Status: {{ store.player.state }} | Volume: {{ store.player.volume }}</small></p>
    <p v-if="store.player.nowPlaying">
      <strong>{{ store.player.nowPlaying.title }}</strong>
      <span v-if="store.player.nowPlaying.artist"> — {{ store.player.nowPlaying.artist }}</span>
    </p>
    <p v-else>No song playing.</p>

    <button class="button" @click="store.refreshRealtime" :disabled="store.loading.queue || store.loading.player">
      Refresh
    </button>
  </section>

  <section class="card">
    <h2>Upcoming Queue</h2>
    <ol v-if="queuedItems.length">
      <li v-for="item in queuedItems" :key="item.id">
        {{ item.song.title }}
        <span v-if="item.song.artist"> — {{ item.song.artist }}</span>
        <small>
          ({{ item.status }}<span v-if="item.requestedBy"> by {{ item.requestedBy }}</span>)
        </small>
      </li>
    </ol>
    <p v-else>There are no queued songs yet.</p>
  </section>
</template>
