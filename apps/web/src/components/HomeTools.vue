<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import LibraryPanel from './panels/LibraryPanel.vue';
import UploadPanel from './panels/UploadPanel.vue';
import MoodsPanel from './panels/MoodsPanel.vue';
import AdminPanel from './panels/AdminPanel.vue';
import ToastHost from './ToastHost.vue';
import { useUiStore } from '../stores/ui';
import { usePreview } from '../lib/preview';

const ui = useUiStore();
const preview = usePreview();
const drawer = ref(null);
const panels = [
  { id: 'library', label: 'Library', component: LibraryPanel },
  { id: 'upload', label: 'Upload', component: UploadPanel },
  { id: 'moods', label: 'Moods', component: MoodsPanel },
  { id: 'admin', label: 'Admin', component: AdminPanel }
];
const activePanel = computed(() => panels.find((panel) => panel.id === ui.homePanel));
let previousOverflow;

function close() {
  ui.homePanel = '';
}

function restoreScroll() {
  if (previousOverflow === undefined) return;
  document.body.style.overflow = previousOverflow;
  previousOverflow = undefined;
}

watch(
  activePanel,
  (panel) => {
    preview.stopAll();
    if (panel) {
      if (!drawer.value.open) {
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        drawer.value.showModal();
      }
    } else {
      drawer.value.close();
      restoreScroll();
    }
  },
  { flush: 'post' }
);

watch(
  () => ui.homePanel,
  () => {
    const body = drawer.value?.querySelector('.drawer-body');
    if (body) body.scrollTop = 0;
  },
  { flush: 'post' }
);

onBeforeUnmount(() => {
  drawer.value?.close();
  restoreScroll();
  close();
});
</script>

<template>
  <nav class="home-tools" aria-label="Jukebox tools">
    <button
      v-for="panel in panels"
      :key="panel.id"
      class="btn"
      type="button"
      aria-haspopup="dialog"
      aria-controls="home-drawer"
      @click="ui.homePanel = panel.id"
    >
      {{ panel.label }}
    </button>
  </nav>

  <dialog
    id="home-drawer"
    ref="drawer"
    class="home-drawer"
    aria-labelledby="home-drawer-title"
    @cancel.prevent="close"
    @close="close"
    @click.self="close"
  >
    <header class="drawer-header">
      <div class="drawer-heading">
        <h2 id="home-drawer-title">{{ activePanel?.label }}</h2>
        <button class="btn btn-sm" type="button" autofocus @click="close">Close</button>
      </div>
      <div class="drawer-nav" role="group" aria-label="Drawer section">
        <button
          v-for="panel in panels"
          :key="panel.id"
          class="chip"
          type="button"
          :aria-pressed="ui.homePanel === panel.id"
          @click="ui.homePanel = panel.id"
        >
          {{ panel.label }}
        </button>
      </div>
    </header>
    <div class="drawer-body">
      <KeepAlive>
        <component
          :is="activePanel.component"
          v-if="activePanel"
          :key="activePanel.id"
          @open-panel="ui.homePanel = $event"
        />
      </KeepAlive>
    </div>
    <ToastHost v-if="activePanel" />
  </dialog>
</template>

<style scoped>
.home-tools,
.drawer-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.home-tools {
  margin-bottom: 1.25rem;
}

.home-drawer {
  width: min(100%, 1000px);
  max-width: 100%;
  height: 100vh;
  height: 100dvh;
  max-height: 100%;
  margin: 0 0 0 auto;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow);
}

.home-drawer[open] {
  display: flex;
  flex-direction: column;
}

.home-drawer::backdrop {
  background: rgba(0, 0, 0, 0.65);
}

.drawer-header {
  flex: none;
  padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) 1rem max(1rem, env(safe-area-inset-left));
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.drawer-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1.25rem max(1rem, env(safe-area-inset-right)) max(1.25rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
}

@media (max-width: 600px) {
  .home-tools .btn {
    flex: 1;
    padding-inline: 0.65rem;
  }

  .home-drawer {
    border-left: 0;
  }
}
</style>
