<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const joinUrl = computed(() => session.joinUrl());
const qrDataUrl = ref('');
const qrError = ref('');
let generation = 0;

async function generateQr() {
  const current = ++generation;
  const url = joinUrl.value;
  qrDataUrl.value = '';
  qrError.value = '';
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 600,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#10110f', light: '#ffffff' }
    });
    if (current === generation) qrDataUrl.value = dataUrl;
  } catch {
    if (current === generation) {
      qrError.value = 'QR code unavailable. Use the join link or retry.';
    }
  }
}

watch(joinUrl, generateQr, { immediate: true });

onBeforeUnmount(() => {
  generation += 1;
});
</script>

<template>
  <aside class="join-invite" aria-label="Invite others to the room">
    <a :href="joinUrl" class="invite-code" aria-label="Open the IrDJ join link">
      <img
        v-if="qrDataUrl"
        :src="qrDataUrl"
        width="112"
        height="112"
        alt="Scan to open IrDJ and join the room"
      />
      <span v-else class="invite-placeholder" role="status">
        {{ qrError ? 'QR unavailable' : 'Preparing QR…' }}
      </span>
    </a>
    <div class="invite-copy">
      <h2>Scan to join the room</h2>
      <p class="muted">Connect to the same Wi-Fi, then scan with your phone.</p>
      <a class="invite-url" :href="joinUrl">{{ joinUrl }}</a>
      <template v-if="qrError">
        <p class="muted" role="status">{{ qrError }}</p>
        <button class="btn btn-sm" type="button" @click="generateQr">Retry QR code</button>
      </template>
      <p v-if="!session.info" class="muted">
        Room address unavailable; using this device's address.
      </p>
    </div>
  </aside>
</template>

<style scoped>
.join-invite {
  position: sticky;
  top: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.25rem;
  padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  box-shadow: var(--shadow);
}

.invite-code {
  display: block;
  flex: none;
  width: 112px;
  height: 112px;
  background: #fff;
}

.invite-code img {
  display: block;
  width: 100%;
  height: 100%;
}

.invite-placeholder {
  display: grid;
  height: 100%;
  place-items: center;
  padding: 0.5rem;
  color: #10110f;
  text-align: center;
  font-size: 0.75rem;
}

.invite-copy {
  min-width: 0;
}

.invite-copy h2 {
  font-size: 1rem;
}

.invite-copy p {
  margin: 0.25rem 0;
  font-size: 0.8rem;
}

.invite-url {
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

@media (max-width: 560px) {
  .join-invite {
    gap: 0.75rem;
  }

  .invite-code {
    width: 96px;
    height: 96px;
  }
}
</style>
