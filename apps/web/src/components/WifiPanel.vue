<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useUiStore } from '../stores/ui';

const ui = useUiStore();

const status = ref(null);
const networks = ref([]);
const scanCached = ref(false);
const loading = ref(false);
const scanning = ref(false);
const connecting = ref(false);

const selectedSsid = ref('');
const password = ref('');
const manualSsid = ref('');
const hidden = ref(false);

const saved = computed(() => status.value?.saved ?? []);
const selected = computed(() => networks.value.find((entry) => entry.ssid === selectedSsid.value) ?? null);
const lastAttempt = computed(() => status.value?.lastAttempt ?? null);

function signalBars(signal) {
  if (signal >= 75) return '▂▄▆█';
  if (signal >= 50) return '▂▄▆';
  if (signal >= 25) return '▂▄';
  return '▂';
}

async function loadStatus() {
  loading.value = true;
  try {
    status.value = await api.get('/api/admin/wifi');
  } catch (error) {
    ui.error(error);
  } finally {
    loading.value = false;
  }
}

async function scan(rescan = true) {
  scanning.value = true;
  try {
    const payload = await api.get(`/api/admin/wifi/networks${rescan ? '?rescan=1' : ''}`);
    networks.value = Array.isArray(payload?.networks) ? payload.networks : [];
    scanCached.value = Boolean(payload?.cached);
  } catch (error) {
    ui.error(error);
  } finally {
    scanning.value = false;
  }
}

function pick(network) {
  selectedSsid.value = selectedSsid.value === network.ssid ? '' : network.ssid;
  password.value = '';
}

async function connect(ssid, { secret = '', isHidden = false } = {}) {
  const warning = status.value?.hotspot
    ? `Join “${ssid}”? This phone will lose the IrDJ-Setup hotspot. If it works, the kiosk screen confirms it; join “${ssid}” on this phone to keep using IrDJ.`
    : `Join “${ssid}”? If IrDJ is reached over the current Wi-Fi, this page may disconnect while it switches.`;
  if (!window.confirm(warning)) return;

  connecting.value = true;
  try {
    const payload = await api.post('/api/admin/wifi/connect', {
      ssid,
      password: secret || undefined,
      hidden: isHidden
    });
    if (payload?.pending) {
      ui.info(`Switching to “${ssid}”…`);
    } else if (payload?.lastAttempt?.status === 'connected') {
      ui.success(`Connected to “${ssid}”`);
    } else {
      ui.error(payload?.lastAttempt?.error || `Could not join “${ssid}”`);
    }
    selectedSsid.value = '';
    password.value = '';
    manualSsid.value = '';
    await loadStatus();
  } catch (error) {
    ui.error(error);
  } finally {
    connecting.value = false;
  }
}

function connectSelected() {
  if (!selected.value) return;
  connect(selected.value.ssid, { secret: password.value });
}

function connectManual() {
  const ssid = manualSsid.value.trim();
  if (!ssid) {
    ui.error('Enter the network name');
    return;
  }
  connect(ssid, { secret: password.value, isHidden: hidden.value });
}

async function forget(entry) {
  if (!window.confirm(`Forget “${entry.ssid}”? IrDJ will no longer join it automatically.`)) return;
  try {
    await api.del(`/api/admin/wifi/saved/${encodeURIComponent(entry.uuid)}`);
    ui.success(`Forgot “${entry.ssid}”`);
    await loadStatus();
  } catch (error) {
    ui.error(error);
  }
}

function onWifiStatus(payload) {
  if (status.value && payload?.lastAttempt) status.value = { ...status.value, lastAttempt: payload.lastAttempt };
  if (payload?.lastAttempt?.status && payload.lastAttempt.status !== 'connecting') loadStatus();
}

onMounted(async () => {
  getSocket()?.on('wifi:status', onWifiStatus);
  await loadStatus();
  if (status.value?.available) scan(false);
});

onBeforeUnmount(() => {
  getSocket()?.off('wifi:status', onWifiStatus);
});
</script>

<template>
  <section class="section">
    <div class="section-head">
      <h2>Wi-Fi</h2>
      <button class="btn btn-sm" type="button" :disabled="scanning || !status?.available" @click="scan(true)">
        {{ scanning ? 'Scanning…' : 'Scan' }}
      </button>
    </div>

    <div class="panel stack">
      <div v-if="loading && !status" class="muted">Checking Wi-Fi…</div>
      <div v-else-if="status && !status.available" class="muted">This box has no Wi-Fi adapter.</div>

      <template v-else-if="status">
        <div class="wifi-now">
          <template v-if="status.hotspot">
            <span class="badge badge-warn">Setup hotspot</span>
            <span>
              Broadcasting <strong>{{ status.hotspot.ssid }}</strong>. Pick the network for this location below.
            </span>
          </template>
          <template v-else-if="status.ssid">
            <span class="badge badge-accent">Connected</span>
            <span>
              <strong>{{ status.ssid }}</strong>
              <span class="muted small">
                · {{ signalBars(status.signal) }} {{ status.signal }}%
                <template v-if="status.address"> · {{ status.address }}</template>
              </span>
            </span>
          </template>
          <template v-else>
            <span class="badge">Not connected</span>
            <span class="muted">Wi-Fi is {{ status.state }}.</span>
          </template>
          <span v-if="status.ethernetConnected" class="muted small">Ethernet is also connected.</span>
        </div>

        <p
          v-if="lastAttempt"
          class="small"
          :class="{ 'wifi-error': lastAttempt.status === 'failed', muted: lastAttempt.status !== 'failed' }"
        >
          <template v-if="lastAttempt.status === 'connecting'">Joining “{{ lastAttempt.ssid }}”…</template>
          <template v-else-if="lastAttempt.status === 'connected'">Joined “{{ lastAttempt.ssid }}”.</template>
          <template v-else>Could not join “{{ lastAttempt.ssid }}”: {{ lastAttempt.error }}</template>
        </p>

        <div>
          <p class="wifi-label">
            Nearby networks
            <span v-if="scanCached" class="muted small">(scanned before the hotspot started)</span>
          </p>
          <div v-if="scanning && !networks.length" class="muted small">Scanning…</div>
          <div v-else-if="!networks.length" class="muted small">No networks found. Tap Scan.</div>
          <ul v-else class="wifi-list">
            <li v-for="network in networks" :key="network.ssid">
              <button
                class="wifi-row"
                type="button"
                :class="{ active: selectedSsid === network.ssid }"
                :aria-expanded="selectedSsid === network.ssid"
                @click="pick(network)"
              >
                <span class="wifi-bars" aria-hidden="true">{{ signalBars(network.signal) }}</span>
                <span class="truncate wifi-ssid">{{ network.ssid }}</span>
                <span v-if="network.ssid === status.ssid" class="badge badge-accent">Connected</span>
                <span v-else-if="network.saved" class="badge">Saved</span>
                <span v-if="network.secure" class="muted small" aria-label="Password protected">🔒</span>
              </button>

              <form
                v-if="selectedSsid === network.ssid && network.ssid !== status.ssid"
                class="wifi-join"
                @submit.prevent="connectSelected"
              >
                <input
                  v-if="network.secure"
                  v-model="password"
                  type="password"
                  autocomplete="off"
                  :placeholder="network.saved ? 'Password (leave empty to use the saved one)' : 'Wi-Fi password'"
                  :aria-label="`Password for ${network.ssid}`"
                />
                <button
                  class="btn btn-primary"
                  type="submit"
                  :disabled="connecting || (network.secure && !network.saved && password.length < 8)"
                >
                  {{ connecting ? 'Joining…' : 'Join' }}
                </button>
              </form>
            </li>
          </ul>
        </div>

        <details class="wifi-manual">
          <summary>Join a hidden network</summary>
          <form class="stack" @submit.prevent="connectManual">
            <div>
              <label for="wifi-manual-ssid">Network name</label>
              <input id="wifi-manual-ssid" v-model="manualSsid" type="text" maxlength="32" autocomplete="off" />
            </div>
            <div>
              <label for="wifi-manual-password">Password</label>
              <input
                id="wifi-manual-password"
                v-model="password"
                type="password"
                autocomplete="off"
                placeholder="Leave empty for an open network"
              />
            </div>
            <label class="wifi-check">
              <input v-model="hidden" type="checkbox" />
              <span>The network is hidden (does not broadcast its name)</span>
            </label>
            <div>
              <button class="btn btn-primary" type="submit" :disabled="connecting">Join</button>
            </div>
          </form>
        </details>

        <div v-if="saved.length">
          <p class="wifi-label">Saved networks</p>
          <ul class="wifi-list">
            <li v-for="entry in saved" :key="entry.uuid" class="wifi-saved">
              <span class="truncate wifi-ssid">{{ entry.ssid }}</span>
              <span v-if="entry.active" class="badge badge-accent">In use</span>
              <button
                v-else
                class="btn btn-sm"
                type="button"
                :disabled="connecting"
                @click="connect(entry.ssid)"
              >
                Join
              </button>
              <button class="btn btn-sm btn-danger" type="button" @click="forget(entry)">Forget</button>
            </li>
          </ul>
        </div>

        <p class="muted small">
          Moving IrDJ somewhere new? If it cannot reach any saved network for about 90 seconds it starts
          its own <strong>IrDJ-Setup</strong> Wi-Fi. The kiosk screen then shows a QR code to join it and
          the address of this page.
        </p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.wifi-now {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.badge-warn {
  background: rgba(233, 185, 73, 0.16);
  color: var(--warn);
}

.wifi-error {
  color: var(--danger);
}

.wifi-label {
  margin: 0 0 0.4rem;
  font-weight: 600;
  font-size: 0.88rem;
}

.wifi-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.wifi-row,
.wifi-saved {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.55rem 0.65rem;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  font: inherit;
  text-align: left;
}

.wifi-row {
  cursor: pointer;
}

.wifi-row:hover,
.wifi-row.active {
  border-color: var(--accent);
}

.wifi-ssid {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 0.9rem;
}

.wifi-bars {
  width: 2.4rem;
  color: var(--accent);
  font-size: 0.8rem;
  letter-spacing: -1px;
}

.wifi-join {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem 0 0.4rem;
}

.wifi-join input {
  flex: 1;
  min-width: 0;
}

.wifi-manual summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.88rem;
}

.wifi-manual[open] summary {
  margin-bottom: 0.7rem;
}

.wifi-check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.wifi-check input {
  accent-color: var(--accent);
}
</style>
