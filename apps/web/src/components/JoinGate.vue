<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';

const props = defineProps({
  mode: { type: String, default: 'join' }
});
const emit = defineEmits(['done', 'cancel']);

const session = useSessionStore();
const ui = useUiStore();
const name = ref(session.name || '');
const gateEl = ref(null);
const inputEl = ref(null);
const qrDataUrl = ref('');
const qrError = ref('');
const error = ref('');
const ready = ref(false);
const generating = ref(false);
const changing = computed(() => props.mode === 'change');
const joinUrl = computed(() => ready.value ? session.joinUrl() : '');
let generation = 0;
let previousFocus = null;

async function generateQr(url = joinUrl.value) {
  if (!url) return;
  const current = ++generation;
  generating.value = true;
  qrError.value = '';
  qrDataUrl.value = '';
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 1200,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#10110f', light: '#ffffff' }
    });
    if (current === generation) qrDataUrl.value = dataUrl;
  } catch {
    if (current === generation) {
      qrError.value = 'The QR code could not be created. Open the link below to join.';
    }
  } finally {
    if (current === generation) generating.value = false;
  }
}

watch(joinUrl, (url) => generateQr(url));

onMounted(async () => {
  previousFocus = document.activeElement;
  // Do not summon the on-screen keyboard before a mobile guest chooses to type.
  if (changing.value) inputEl.value?.focus();
  else gateEl.value?.focus();
  await session.loadInfo();
  ready.value = true;
});

onBeforeUnmount(() => {
  generation += 1;
  if (changing.value) nextTick(() => previousFocus?.focus());
});

function onKeydown(event) {
  if (event.key === 'Escape' && changing.value) {
    event.preventDefault();
    emit('cancel');
  }
  if (event.key !== 'Tab' || !changing.value) return;
  const controls = gateEl.value.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled)');
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function submit() {
  const clean = name.value.trim();
  if (!clean) {
    error.value = 'Please enter a name or alias.';
    inputEl.value?.focus();
    return;
  }
  session.setName(clean);
  ui.success(changing.value ? `You are now “${clean}”` : `Welcome, ${clean}!`);
  emit('done');
}
</script>

<template>
  <div
    ref="gateEl"
    class="gate"
    :class="{ 'gate-change': changing }"
    :role="changing ? 'dialog' : 'main'"
    :aria-modal="changing ? true : undefined"
    aria-labelledby="gate-title"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <div class="landing">
      <header class="landing-header">
        <div class="brand" aria-label="IrDJ jukebox">
          <span class="brand-mark" aria-hidden="true">ir</span>
          <span class="brand-name">IrDJ<span>THE SHARED JUKEBOX</span></span>
        </div>
        <span class="room-label">Your room. Your soundtrack.</span>
      </header>

      <div class="landing-body">
        <section class="welcome">
          <p class="eyebrow">{{ changing ? 'MAKE IT YOURS' : 'GOOD MUSIC IS BETTER TOGETHER' }}</p>
          <h1 id="gate-title">
            <template v-if="changing">A new name.<br />Same great taste.</template>
            <template v-else>One room.<br />Everyone's <span>soundtrack.</span></template>
          </h1>
          <p class="welcome-copy">
            {{ changing
              ? 'Pick a new name or alias. Songs already queued stay tied to the name that requested them.'
              : 'Discover a track, add it to the queue, and let the room take it from there. No account. Just music.' }}
          </p>

          <form class="gate-form" @submit.prevent="submit">
            <h2>{{ changing ? 'Change your name' : 'Join on this device' }}</h2>
            <label for="gate-name">Your name or DJ alias</label>
            <div class="form-controls">
              <input
                id="gate-name"
                ref="inputEl"
                v-model="name"
                type="text"
                maxlength="60"
                autocomplete="nickname"
                enterkeyhint="go"
                placeholder="What should we call you?"
                :aria-invalid="Boolean(error)"
                :aria-describedby="error ? 'gate-error gate-note' : 'gate-note'"
                @input="error = ''"
              />
              <button class="btn btn-primary" type="submit">
                {{ changing ? 'Save name' : 'Join the room' }}
                <span aria-hidden="true">&rarr;</span>
              </button>
            </div>
            <p v-if="error" id="gate-error" class="gate-error" role="alert">{{ error }}</p>
            <p id="gate-note" class="form-note">Your name is saved only on this device.</p>
            <button v-if="changing" class="btn btn-ghost cancel" type="button" @click="emit('cancel')">
              Cancel
            </button>
          </form>
        </section>

        <aside class="gate-qr" aria-labelledby="qr-title">
          <span class="qr-kicker">BRING YOUR OWN DEVICE</span>
          <h2 id="qr-title">Scan. Join. Play.</h2>
          <p class="qr-copy">Open your camera and scan to join on your phone.</p>
          <div class="qr-frame" :aria-busy="generating || !ready">
            <img
              v-if="qrDataUrl"
              :src="qrDataUrl"
              alt="Scan this QR code to open IrDJ and join the room"
              class="qr"
              width="1200"
              height="1200"
            />
            <div v-else class="qr-placeholder" role="status">
              {{ qrError || 'Preparing your invite...' }}
            </div>
          </div>
          <button v-if="qrError" class="btn btn-sm" type="button" @click="generateQr()">Retry QR code</button>
          <p class="network-note">Connect to the same Wi-Fi as this jukebox.</p>
          <a v-if="joinUrl" :href="joinUrl" class="join-url" aria-label="Open the IrDJ join link">{{ joinUrl }}</a>
          <p v-if="ready && !session.info" class="info-warning" role="status">
            The room address is unavailable. This link uses the current device's address.
          </p>
        </aside>
      </div>

      <footer v-if="!changing" class="landing-footer" aria-label="How it works">
        <div><span class="step-number">01</span><span>Join the room</span></div>
        <div><span class="step-number">02</span><span>Find your favorites</span></div>
        <div><span class="step-number">03</span><span>Shape the soundtrack</span></div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.gate {
  min-height: 100vh;
  min-height: 100svh;
  padding: clamp(1.25rem, 3vw, 4rem);
  background:
    radial-gradient(ellipse at 12% 42%, rgba(201, 243, 106, 0.09), transparent 55%),
    radial-gradient(ellipse at 95% 0%, rgba(201, 243, 106, 0.06), transparent 40%),
    var(--bg);
}

.gate:focus {
  outline: none;
}

.landing {
  display: flex;
  min-height: calc(100svh - clamp(2.5rem, 6vw, 8rem));
  width: 100%;
  max-width: 1800px;
  margin: 0 auto;
  flex-direction: column;
  gap: clamp(1.5rem, 3vh, 3rem);
}

.landing-header,
.brand {
  display: flex;
  align-items: center;
}

.landing-header {
  justify-content: space-between;
  gap: 1rem;
}

.brand {
  gap: 0.85rem;
}

.brand-mark {
  display: grid;
  width: clamp(44px, 3.5vw, 68px);
  aspect-ratio: 1;
  place-items: center;
  border-radius: 30%;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: clamp(1.3rem, 2vw, 2rem);
  font-weight: 850;
  letter-spacing: -0.08em;
}

.brand-name {
  font-size: clamp(1.25rem, 1.7vw, 2rem);
  font-weight: 750;
  letter-spacing: -0.04em;
}

.brand-name span {
  display: block;
  color: var(--text-dim);
  font-size: clamp(0.6rem, 0.65vw, 0.85rem);
  letter-spacing: 0.15em;
}

.room-label {
  color: var(--text-dim);
  font-size: clamp(0.8rem, 1vw, 1.2rem);
}

.landing-body {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  align-items: center;
  gap: clamp(2rem, 6vw, 7rem);
  flex: 1;
}

.welcome,
.gate-qr {
  min-width: 0;
}

.eyebrow,
.qr-kicker {
  color: var(--accent);
  font-size: clamp(0.68rem, 0.8vw, 1rem);
  font-weight: 700;
  letter-spacing: 0.16em;
}

.eyebrow {
  margin-bottom: 1.25rem;
}

.welcome h1 {
  font-size: clamp(2.8rem, 5.2vw, 6.5rem);
  line-height: 1.04;
  letter-spacing: -0.065em;
  overflow-wrap: anywhere;
}

.welcome h1 span {
  color: var(--accent);
}

.welcome-copy {
  max-width: 38em;
  margin: 1.5rem 0 0;
  color: var(--text-dim);
  font-size: clamp(1rem, 1.25vw, 1.5rem);
  line-height: 1.65;
}

.gate-form {
  display: grid;
  max-width: 680px;
  gap: 0.6rem;
  margin-top: clamp(2rem, 3vw, 3.5rem);
}

.gate-form h2 {
  margin-bottom: 0.35rem;
  font-size: clamp(1.1rem, 1.3vw, 1.5rem);
}

.gate-form label,
.form-note,
.gate-error {
  font-size: clamp(0.8rem, 0.9vw, 1.1rem);
}

.form-controls {
  display: flex;
  gap: 0.65rem;
}

.form-controls input {
  min-width: 0;
  min-height: clamp(52px, 3.5vw, 72px);
  flex: 1;
  font-size: clamp(1rem, 1.1vw, 1.3rem);
}

.form-controls .btn {
  gap: 0.8rem;
  padding: 0.8rem 1.25rem;
  border-radius: var(--radius-sm);
  font-size: clamp(0.9rem, 1vw, 1.2rem);
}

.form-note {
  margin: 0;
  color: var(--text-faint);
}

.gate-error {
  margin: 0;
  color: var(--danger);
}

.cancel {
  justify-self: start;
}

.gate-qr {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: clamp(1.5rem, 2vw, 3rem);
  border: 1px solid var(--border);
  border-radius: clamp(20px, 2vw, 32px);
  background: linear-gradient(145deg, rgba(201, 243, 106, 0.05), transparent), var(--surface);
  text-align: center;
}

.gate-qr h2 {
  margin-top: 0.75rem;
  font-size: clamp(1.6rem, 2.2vw, 2.8rem);
  letter-spacing: -0.045em;
}

.qr-copy {
  max-width: 26em;
  margin: 0.75rem 0 1.5rem;
  color: var(--text-dim);
  font-size: clamp(0.9rem, 1vw, 1.3rem);
}

.qr-frame {
  width: min(100%, clamp(220px, 22vw, 520px));
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 16px;
  background: #fff;
}

.qr {
  display: block;
  width: 100%;
  height: auto;
}

.qr-placeholder {
  display: grid;
  height: 100%;
  padding: 1.5rem;
  place-items: center;
  color: #30332b;
}

.network-note {
  margin: 1.25rem 0 0.5rem;
  color: var(--text-dim);
  font-size: clamp(0.8rem, 0.95vw, 1.2rem);
}

.join-url {
  max-width: 100%;
  padding: 0.35rem 0;
  font-size: clamp(0.85rem, 1.05vw, 1.4rem);
  overflow-wrap: anywhere;
}

.info-warning {
  margin: 0.75rem 0 0;
  color: var(--warn);
  font-size: 0.85rem;
}

.landing-footer {
  display: flex;
  justify-content: space-between;
  gap: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
}

.landing-footer div {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  color: var(--text-dim);
  font-size: clamp(0.85rem, 1.1vw, 1.3rem);
}

.step-number {
  color: var(--accent);
  font-size: 0.8em;
  font-variant-numeric: tabular-nums;
}

.gate-change {
  position: fixed;
  inset: 0;
  z-index: 200;
  overflow-y: auto;
}

@media (max-width: 1000px) {
  .landing-body {
    gap: 2rem;
  }

  .form-controls {
    flex-direction: column;
  }

  .form-controls .btn {
    min-height: 52px;
  }
}

@media (max-width: 700px) {
  .landing {
    gap: 2rem;
  }

  .landing-body {
    grid-template-columns: 1fr;
  }

  .room-label {
    display: none;
  }

  .welcome h1 {
    font-size: clamp(2.5rem, 8.5vw, 3.75rem);
  }

  .welcome-copy {
    margin-top: 1rem;
  }

  .gate-form {
    margin-top: 1.5rem;
  }

  .gate-qr {
    padding: 1.5rem;
  }

  .qr-frame {
    width: min(100%, 280px);
  }

  .landing-footer {
    flex-direction: column;
    gap: 0.75rem;
  }
}

@media (min-width: 2200px) {
  .landing {
    max-width: 2600px;
  }

  .welcome h1 {
    font-size: clamp(6.5rem, 5vw, 11rem);
  }

  .qr-frame {
    width: min(100%, 26vw, 800px);
  }

  .welcome-copy {
    font-size: clamp(1.5rem, 1.25vw, 3rem);
  }

  .qr-copy,
  .network-note,
  .join-url,
  .landing-footer div,
  .form-controls input,
  .form-controls .btn {
    font-size: clamp(1.2rem, 1vw, 2.5rem);
  }

  .gate-form label,
  .form-note {
    font-size: clamp(1rem, 0.85vw, 2rem);
  }
}

@media (max-height: 600px) and (min-width: 701px) {
  .gate {
    padding: 1.5rem;
  }

  .landing {
    gap: 1.5rem;
  }

  .welcome h1 {
    font-size: clamp(2.5rem, 4vw, 4rem);
  }

  .gate-form {
    margin-top: 1.25rem;
  }

  .gate-qr {
    padding: 1.25rem;
  }

  .qr-frame {
    width: min(100%, 200px);
  }
}
</style>
