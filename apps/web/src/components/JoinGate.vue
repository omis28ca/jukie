<script setup>
import { onMounted, ref } from 'vue';
import QRCode from 'qrcode';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';

const props = defineProps({
  mode: { type: String, default: 'join' } // 'join' | 'change'
});
const emit = defineEmits(['done', 'cancel']);

const session = useSessionStore();
const ui = useUiStore();

const name = ref(session.name || '');
const qrDataUrl = ref('');
const joinUrl = ref('');
const inputEl = ref(null);
const error = ref('');

onMounted(async () => {
  inputEl.value?.focus();
  await session.loadInfo();
  joinUrl.value = session.joinUrl();
  try {
    qrDataUrl.value = await QRCode.toDataURL(joinUrl.value, {
      width: 220,
      margin: 1,
      color: { dark: '#f2f2f2', light: '#00000000' }
    });
  } catch {
    qrDataUrl.value = '';
  }
});

function submit() {
  const clean = name.value.trim();
  if (!clean) {
    error.value = 'Please enter a name or alias.';
    inputEl.value?.focus();
    return;
  }
  session.setName(clean);
  ui.success(props.mode === 'change' ? `You are now “${clean}”` : `Welcome, ${clean}!`);
  emit('done');
}
</script>

<template>
  <div class="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
    <div class="gate-card">
      <div class="gate-main">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">♪</span>
          <span class="brand-name">Jukie</span>
        </div>
        <h1 id="gate-title">
          {{ mode === 'change' ? 'Change your name' : 'Join the jukebox' }}
        </h1>
        <p class="muted">
          {{
            mode === 'change'
              ? 'Pick a new name or alias. Your queued songs stay tied to the name that requested them.'
              : 'Pick a name or alias so everyone knows who queued what. It is stored on this device only.'
          }}
        </p>

        <form class="gate-form" @submit.prevent="submit">
          <label for="gate-name">Name or alias</label>
          <input
            id="gate-name"
            ref="inputEl"
            v-model="name"
            type="text"
            maxlength="60"
            autocomplete="nickname"
            placeholder="e.g. DJ Pickles"
            :aria-invalid="Boolean(error)"
            aria-describedby="gate-error"
            @input="error = ''"
          />
          <p v-if="error" id="gate-error" class="gate-error">{{ error }}</p>
          <div class="gate-actions">
            <button class="btn btn-primary" type="submit">
              {{ mode === 'change' ? 'Save name' : 'Start listening' }}
            </button>
            <button
              v-if="mode === 'change'"
              class="btn btn-ghost"
              type="button"
              @click="emit('cancel')"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>

      <aside class="gate-qr">
        <h2>Invite the room</h2>
        <p class="muted small">Scan to open Jukie on another phone.</p>
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR code to join Jukie" class="qr" />
        <div v-else class="qr qr-empty" aria-hidden="true">QR</div>
        <code class="join-url">{{ joinUrl }}</code>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.gate {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  background: radial-gradient(1200px 600px at 20% -10%, #1d2b2a 0%, #0d0d0d 60%);
  overflow-y: auto;
}

.gate-card {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.85fr);
  gap: 1.5rem;
  width: min(860px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: var(--shadow);
  padding: 2rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 1.25rem;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 1.1rem;
  font-weight: 700;
}

.brand-name {
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.gate-form {
  margin-top: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.gate-actions {
  margin-top: 0.9rem;
  display: flex;
  gap: 0.5rem;
}

.gate-error {
  color: var(--danger);
  font-size: 0.82rem;
  margin: 0;
}

.gate-qr {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.1rem;
  text-align: center;
}

.gate-qr h2 {
  font-size: 0.95rem;
}

.small {
  font-size: 0.8rem;
}

.qr {
  width: 180px;
  height: 180px;
  margin: 0.6rem auto;
  display: block;
  image-rendering: pixelated;
}

.qr-empty {
  display: grid;
  place-items: center;
  color: var(--text-faint);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
}

.join-url {
  display: block;
  font-size: 0.72rem;
  color: var(--text-dim);
  word-break: break-all;
}

@media (max-width: 760px) {
  .gate-card {
    grid-template-columns: 1fr;
    padding: 1.4rem;
  }

  .gate-qr {
    order: -1;
  }

  .qr {
    width: 140px;
    height: 140px;
  }
}
</style>
