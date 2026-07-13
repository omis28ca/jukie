<script setup>
import { onMounted } from "vue";
import { useJukeboxStore } from "./stores/jukebox";

const store = useJukeboxStore();

onMounted(() => {
  store.init();
});
</script>

<template>
  <main class="lcars-shell">
    <aside class="lcars-rail">
      <div class="rail-cap">LCARS</div>
      <nav class="rail-nav">
        <RouterLink to="/" active-class="nav-active">Now Playing</RouterLink>
        <RouterLink to="/library" active-class="nav-active">Library</RouterLink>
        <RouterLink to="/upload" active-class="nav-active">Upload</RouterLink>
        <RouterLink to="/admin" active-class="nav-active">Admin</RouterLink>
      </nav>
      <div class="rail-foot">Stardate 2026.194</div>
    </aside>

    <section class="lcars-content">
      <header class="header">
        <h1>Audio Access Terminal</h1>
        <div class="header-pills">
          <span>01</span>
          <span>02</span>
          <span>03</span>
        </div>
      </header>

      <p class="connection" :class="store.socketConnected ? 'ok' : 'warn'">
        {{ store.socketConnected ? "Live updates connected" : "Reconnecting live updates..." }}
      </p>

      <p v-if="store.errorMessage" class="alert error">{{ store.errorMessage }}</p>
      <p v-if="store.statusMessage" class="alert success">{{ store.statusMessage }}</p>

      <RouterView />
    </section>
  </main>
</template>
