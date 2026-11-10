<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import BottomTabs from './components/BottomTabs.vue';
import WifiSetupBanner from './components/WifiSetupBanner.vue';
import PlayerBar from './components/PlayerBar.vue';
import ToastHost from './components/ToastHost.vue';
import JoinGate from './components/JoinGate.vue';
import JoinInvite from './components/JoinInvite.vue';
import { useSessionStore } from './stores/session';
import { useUiStore } from './stores/ui';
import { usePlayerStore } from './stores/player';
import { useQueueStore } from './stores/queue';
import { useLibraryStore } from './stores/library';
import { useMoodsStore } from './stores/moods';
import { useMqttStore } from './stores/mqtt';
import { useYoutubeStore } from './stores/youtube';
import { useChatStore } from './stores/chat';
import { initials } from './lib/format';
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
const pageTitle = computed(() => route.meta?.title || 'IrDJ');

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

onBeforeUnmount(() => {
  player.stopTicker();
  mqtt.disconnect();
  disposeSocket();
});

function onGateDone() {
  changingName.value = false;
  if (booted.value) {
    // Re-fetch so ownership flags (isMine / hasDownvoted) reflect the new identity.
    queue.fetch();
  }
}
</script>

<template>
  <div class="app-shell">
    <div v-if="session.hasJoined" :inert="showGate" :aria-hidden="showGate || undefined">
      <div class="app-main">

        <main class="content">
          <JoinInvite />
          <WifiSetupBanner />
          <RouterView />
        </main>

      </div>

    </div>
    <ToastHost v-if="!ui.homePanel" />

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
  min-height: 100vh;
}

.app-main > * {
  min-width: 0;
}

.app-main .content {
  width: 100%;
  max-width: none;
  padding: 2rem clamp(1.25rem, 3.5vw, 3.5rem) 2rem;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 60;
  display: flex;
  min-height: 76px;
  align-items: center;
  gap: 0.9rem;
  padding: 0.8rem clamp(1.25rem, 3.5vw, 3.5rem);
  border-bottom: 1px solid rgba(255, 255, 255, 0.055);
  background: rgba(16, 17, 15, 0.84);
  backdrop-filter: blur(18px);
}

.topbar-title {
  flex: 1;
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.offline {
  border-color: rgba(239, 201, 106, 0.3);
  color: var(--warn);
}

.avatar {
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  place-items: center;
  border: 1px solid rgba(201, 243, 106, 0.35);
  border-radius: 50%;
  background: rgba(201, 243, 106, 0.12);
  color: var(--accent);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 750;
  cursor: pointer;
}

.avatar:hover {
  background: rgba(201, 243, 106, 0.2);
}

.content {
  padding: 1.5rem;
}
</style>
