<script setup>
import { onMounted } from "vue";
import { useJukeboxStore } from "./stores/jukebox";

const store = useJukeboxStore();

onMounted(() => {
  store.init();
});
</script>

<template>
  <div class="app-root">
    <RouterView />

    <div class="toast-stack" aria-live="polite" aria-atomic="true">
      <div v-if="store.errorMessage" class="toast toast-error" role="alert">
        <span class="toast-icon" aria-hidden="true">!</span>
        <span>{{ store.errorMessage }}</span>
        <button type="button" aria-label="Dismiss error" @click="store.setError('')">×</button>
      </div>
      <div v-if="store.statusMessage" class="toast toast-success" role="status">
        <span class="toast-icon" aria-hidden="true">✓</span>
        <span>{{ store.statusMessage }}</span>
        <button type="button" aria-label="Dismiss message" @click="store.setStatus('')">×</button>
      </div>
    </div>
  </div>
</template>
