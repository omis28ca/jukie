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
    const album = (song.album || "").toLowerCase();
    const genre = (song.genre || "").toLowerCase();
    return title.includes(needle) || artist.includes(needle) || album.includes(needle) || genre.includes(needle);
  });
});

onMounted(() => {
  store.init();
  store.fetchSongs({ silent: true });
});

function add(songId) {
  store.addToQueue(songId, requestedBy.value);
}

function removeSong(songId, title) {
  const shouldDelete = window.confirm(`Delete \"${title}\"?`);
  if (!shouldDelete) return;
  store.deleteSong(songId);
}
</script>

<template>
  <section class="card">
    <h2>Library</h2>
    <p>
      <input class="input" v-model="requestedBy" placeholder="Your name, optional" />
    </p>
    <p>
      <input class="input" v-model="query" placeholder="Search title, artist, album, or genre" />
    </p>
    <button class="button" @click="store.fetchSongs" :disabled="store.loading.songs">Reload Library</button>
    <p><small>Set Admin PIN on the Admin page to enable delete actions.</small></p>
  </section>

  <section v-if="store.loading.songs" class="card">
    <p>Loading songs...</p>
  </section>

  <section class="card" v-for="song in filteredSongs" :key="song.id">
    <div class="library-song-row">
      <img v-if="song.artworkUrl" :src="song.artworkUrl" alt="Album art" class="library-artwork" />
      <div>
        <h3>{{ song.title }}</h3>
        <p v-if="song.artist">{{ song.artist }}</p>
        <p v-if="song.album || song.year || song.genre">
          <small>
            <span v-if="song.album">{{ song.album }}</span>
            <span v-if="song.year"> ({{ song.year }})</span>
            <span v-if="song.genre"> - {{ song.genre }}</span>
          </small>
        </p>
      </div>
    </div>
    <p>
      <button class="button" @click="add(song.id)" :disabled="store.loading.queueAdd">
        Add to Queue
      </button>
      <button
        class="button button-danger"
        @click="removeSong(song.id, song.title)"
        :disabled="store.loading.admin || !store.adminPin"
      >
        Delete
      </button>
    </p>
  </section>

  <section v-if="!store.loading.songs && !filteredSongs.length" class="card">
    <p>No songs found.</p>
  </section>
</template>
