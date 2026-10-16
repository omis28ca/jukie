<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { getSocket } from '../lib/socket';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();

const setup = computed(() => session.info?.wifiSetup ?? null);
const qrDataUrl = ref('');
const lastAttempt = ref(null);
let pollTimer = null;

// Wi-Fi QR format understood by phone cameras: scanning it offers to join the network.
function escapeWifi(value) {
  return String(value).replace(/([\\;,:"])/g, '\\$1');
}

watch(
  setup,
  async (value) => {
    if (!value?.password) {
      qrDataUrl.value = '';
      return;
    }
    const payload = `WIFI:T:WPA;S:${escapeWifi(value.ssid)};P:${escapeWifi(value.password)};;`;
    qrDataUrl.value = await QRCode.toDataURL(payload, { margin: 1, width: 220 }).catch(() => '');
  },
  { immediate: true }
);

function onWifiStatus(payload) {
  if (payload?.lastAttempt) lastAttempt.value = payload.lastAttempt;
  // A finished attempt may have taken the hotspot down (or brought it back).
  if (payload?.lastAttempt?.status !== 'connecting') session.loadInfo();
}

onMounted(() => {
  getSocket()?.on('wifi:status', onWifiStatus);
  // The box can lose its network at any time, so keep checking whether setup mode began.
  pollTimer = setInterval(() => session.loadInfo(), 20000);
});

onBeforeUnmount(() => {
  getSocket()?.off('wifi:status', onWifiStatus);
  clearInterval(pollTimer);
});
</script>

<template>
  <div v-if="setup" class="wifi-setup" role="status">
    <div class="ws-body">
      <p class="ws-kicker">Wi-Fi setup</p>
      <h2 class="ws-title">IrDJ needs a Wi-Fi network</h2>

      <ol v-if="setup.password" class="ws-steps">
        <li>
          Scan the code, or join <strong>{{ setup.ssid }}</strong> with password
          <strong class="ws-mono">{{ setup.password }}</strong>
        </li>
        <li>Open <strong class="ws-mono">{{ setup.url }}</strong></li>
        <li>Enter the admin PIN, then pick this location's network under <strong>Wi-Fi</strong></li>
      </ol>
      <p v-else class="ws-text">
        You're on the <strong>{{ setup.ssid }}</strong> hotspot.
        <RouterLink to="/admin">Open Admin → Wi-Fi</RouterLink> to pick this location's network.
      </p>

      <p v-if="lastAttempt?.status === 'connecting'" class="ws-status">Joining “{{ lastAttempt.ssid }}”…</p>
      <p v-else-if="lastAttempt?.status === 'failed'" class="ws-status ws-failed">
        Could not join “{{ lastAttempt.ssid }}”: {{ lastAttempt.error }}
      </p>
    </div>
    <img v-if="qrDataUrl" :src="qrDataUrl" class="ws-qr" :alt="`QR code to join the ${setup.ssid} Wi-Fi`" />
  </div>
  <div
    v-else-if="lastAttempt?.status === 'connected'"
    class="wifi-setup ws-done"
    role="status"
  >
    <div class="ws-body">
      <p class="ws-kicker">Wi-Fi setup</p>
      <h2 class="ws-title">Connected to “{{ lastAttempt.ssid }}”</h2>
      <p class="ws-text">Join the same network on your phone to keep using IrDJ.</p>
    </div>
    <button class="btn btn-sm" type="button" @click="lastAttempt = null">Dismiss</button>
  </div>
</template>

<style scoped>
.wifi-setup {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  margin-bottom: 1.25rem;
  padding: 1.1rem 1.2rem;
  border-radius: var(--radius);
  border: 1px solid var(--warn);
  background: rgba(233, 185, 73, 0.08);
}

.ws-done {
  border-color: var(--ok);
  background: rgba(86, 194, 113, 0.08);
}

.ws-body {
  flex: 1;
  min-width: 0;
}

.ws-kicker {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--warn);
}

.ws-done .ws-kicker {
  color: var(--ok);
}

.ws-title {
  margin: 0.2rem 0 0.6rem;
  font-size: 1.2rem;
}

.ws-steps {
  margin: 0;
  padding-left: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.92rem;
}

.ws-text {
  margin: 0;
  font-size: 0.92rem;
}

.ws-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.ws-status {
  margin: 0.7rem 0 0;
  font-size: 0.85rem;
  color: var(--text-dim);
}

.ws-failed {
  color: var(--danger);
}

.ws-qr {
  flex: none;
  width: 150px;
  height: 150px;
  border-radius: 8px;
  background: #fff;
}

@media (max-width: 520px) {
  .wifi-setup {
    flex-direction: column-reverse;
    align-items: flex-start;
  }
}
</style>
