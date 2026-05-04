<script setup>
import { onMounted } from "vue";
import { useJukeboxStore } from "./stores/jukebox";

const store = useJukeboxStore();

onMounted(() => {
  store.init();
});
</script>

<template>
  <main class="shell">
    <header class="header">
      <h1>Office Jukebox</h1>
      <nav>
        <RouterLink to="/" active-class="nav-active">Now Playing</RouterLink>
        <RouterLink to="/library" active-class="nav-active">Library</RouterLink>
        <RouterLink to="/upload" active-class="nav-active">Upload</RouterLink>
        <RouterLink to="/admin" active-class="nav-active">Admin</RouterLink>
      </nav>
    </header>

    <p class="connection" :class="store.socketConnected ? 'ok' : 'warn'">
      {{ store.socketConnected ? "Live updates connected" : "Reconnecting live updates..." }}
    </p>

    <p v-if="store.errorMessage" class="alert error">{{ store.errorMessage }}</p>
    <p v-if="store.statusMessage" class="alert success">{{ store.statusMessage }}</p>

    <RouterView />
  </main>
</template>
