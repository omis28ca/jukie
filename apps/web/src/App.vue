<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppSidebar from './components/AppSidebar.vue';
import PlayerBar from './components/PlayerBar.vue';
import ToastHost from './components/ToastHost.vue';
import JoinGate from './components/JoinGate.vue';
import { useSessionStore } from './stores/session';
import { useUiStore } from './stores/ui';
import { usePlayerStore } from './stores/player';
import { useQueueStore } from './stores/queue';
import { useLibraryStore } from './stores/library';
import { useMoodsStore } from './stores/moods';
import { useMqttStore } from './stores/mqtt';
import { useYoutubeStore } from './stores/youtube';
import { useChatStore } from './stores/chat';
import { disposeSocket, initSocket, updateSocketIdentity } from './lib/socket';

const route = useRoute();
const session = useSessionStore();
const ui = useUiStore();
const player = usePlayerStore();
const queue = useQueueStore();
const library = useLibraryStore();
const moods = useMoodsStore();
const mqtt = useMqttStore();
const youtube = useYoutubeStore();
const chat = useChatStore();

const changingName = ref(false);
const booted = ref(false);

const showGate = computed(() => !session.hasJoined || changingName.value);
const pageTitle = computed(() => route.meta?.title || 'Jukie');

async function boot() {
  if (booted.value) return;
  booted.value = true;

  initSocket({
    queueStore: queue,
    playerStore: player,
    libraryStore: library,
    moodsStore: moods,
    uiStore: ui,
    sessionStore: session,
    youtubeStore: youtube,
    chatStore: chat
  });

  player.startTicker();

  await Promise.all([
    player.fetch(),
    queue.fetch(),
    library.fetch(),
    moods.fetch(),
    session.loadInfo(),
    session.restoreAdmin(),
    chat.fetch()
  ]);

  if (mqtt.enabled) await mqtt.connect();
}

watch(
  () => session.hasJoined,
  (joined) => {
    if (joined) boot();
  },
  { immediate: true }
);

// The socket handshake carries the identity, so reconnect whenever it changes.
watch(
  () => [session.name, session.pin],
  ([name, pin]) => {
    if (!booted.value) return;
    updateSocketIdentity({ name, pin });
    queue.fetch();
  }
);

onMounted(() => {
  session.loadInfo();
});

onBeforeUnmount(() => {
  player.stopTicker();
  mqtt.disconnect();
  disposeSocket();
});

function onGateDone() {
  changingName.value = false;
  ui.closeSidebar();
  if (booted.value) {
    // Re-fetch so ownership flags (isMine / hasDownvoted) reflect the new identity.
    queue.fetch();
  }
}
</script>

<template>
  <div class="app-shell">
    <AppSidebar @change-name="changingName = true" />

    <div class="app-main">
      <header class="topbar">
        <button
          class="btn btn-icon hamburger"
          type="button"
          :aria-expanded="ui.sidebarOpen"
          aria-label="Toggle navigation menu"
          @click="ui.toggleSidebar()"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <h1 class="topbar-title">{{ pageTitle }}</h1>
        <span v-if="!ui.connected" class="chip offline" title="Live updates unavailable">
          Offline
        </span>
      </header>

      <main class="content">
        <RouterView />
      </main>
    </div>

    <PlayerBar />
    <ToastHost />

    <JoinGate
      v-if="showGate"
      :mode="changingName ? 'change' : 'join'"
      @done="onGateDone"
      @cancel="changingName = false"
    />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.app-main {
  margin-left: var(--sidebar-w);
  padding-bottom: calc(var(--player-h) + 16px);
  min-height: 100vh;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1.5rem;
  background: rgba(13, 13, 13, 0.9);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}

.topbar-title {
  font-size: 1.15rem;
  font-weight: 650;
}

.offline {
  margin-left: auto;
  color: var(--warn);
  border-color: #4a3d1c;
}

.hamburger {
  display: none;
}

.content {
  padding: 1.5rem;
  max-width: 1400px;
}

@media (max-width: 900px) {
  .app-main {
    margin-left: 0;
    padding-bottom: 180px;
  }

  .hamburger {
    display: inline-flex;
  }

  .topbar {
    padding: 0.7rem 1rem;
  }

  .content {
    padding: 1rem;
  }
}
</style>
