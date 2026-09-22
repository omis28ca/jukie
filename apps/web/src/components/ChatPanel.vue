<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useChatStore } from '../stores/chat';
import { useSessionStore } from '../stores/session';
import { initials } from '../lib/format';

const chat = useChatStore();
const session = useSessionStore();

const draft = ref('');
const listEl = ref(null);

const MAX_LENGTH = 280;
const remaining = computed(() => MAX_LENGTH - draft.value.length);

function clockTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function displayName(entry) {
  return entry.name || 'Guest';
}

function isMine(message) {
  return Boolean(session.name) && message.name === session.name;
}

async function scrollToLatest() {
  await nextTick();
  const el = listEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function send() {
  const body = draft.value.trim();
  if (!body || chat.sending) return;
  try {
    await chat.send(body);
    draft.value = '';
    scrollToLatest();
  } catch {
    /* toast already raised */
  }
}

onMounted(() => {
  if (!chat.loaded) chat.fetch().then(scrollToLatest);
  else scrollToLatest();
});

watch(() => chat.messages.length, scrollToLatest);
</script>

<template>
  <section class="section" aria-label="Room chat">
    <div class="section-head">
      <h2>Room chat</h2>
      <span class="sub">{{ chat.onlineCount }} {{ chat.onlineCount === 1 ? 'person' : 'people' }} here</span>
    </div>

    <div class="panel chat">
      <ul class="who" aria-label="People online">
        <li v-for="person in chat.presence" :key="person.key" class="chip who-chip">
          <span class="dot" aria-hidden="true"></span>
          {{ displayName(person) }}
          <span v-if="person.isAdmin" class="badge badge-accent">admin</span>
        </li>
        <li v-if="!chat.presence.length" class="chip who-chip faint">Nobody connected</li>
      </ul>

      <div ref="listEl" class="messages" role="log" aria-live="polite">
        <p v-if="!chat.messages.length" class="empty">
          No messages yet. Say hello to the room.
        </p>
        <div
          v-for="message in chat.messages"
          :key="message.id"
          class="msg"
          :class="{ mine: isMine(message) }"
        >
          <span class="avatar" aria-hidden="true">{{ initials(message.name) }}</span>
          <div class="msg-body">
            <p class="msg-meta faint">
              <strong>{{ message.name }}</strong>
              <span v-if="message.isAdmin" class="badge badge-accent">admin</span>
              <span>{{ clockTime(message.createdAt) }}</span>
            </p>
            <p class="msg-text">{{ message.body }}</p>
          </div>
        </div>
      </div>

      <form class="composer" @submit.prevent="send">
        <label class="sr-only" for="chat-input">Message the room</label>
        <input
          id="chat-input"
          v-model="draft"
          type="text"
          :maxlength="MAX_LENGTH"
          placeholder="Message the room…"
          autocomplete="off"
        />
        <span class="count faint" :class="{ warn: remaining < 20 }">{{ remaining }}</span>
        <button class="btn btn-primary" type="submit" :disabled="!draft.trim() || chat.sending">
          Send
        </button>
        <button
          v-if="session.isAdmin"
          class="btn btn-danger"
          type="button"
          :disabled="!chat.messages.length"
          @click="chat.clear()"
        >
          Clear
        </button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.chat {
  padding: 0.9rem;
  display: grid;
  gap: 0.75rem;
}

.who {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.who-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ok, #4ccf7a);
}

.messages {
  max-height: 320px;
  min-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-right: 0.3rem;
}

.msg {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 0.55rem;
  align-items: start;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--surface-3);
  font-size: 0.72rem;
  font-weight: 650;
}

.msg.mine .avatar {
  background: var(--accent);
  color: #0d0d0d;
}

.msg-body {
  min-width: 0;
}

.msg-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.74rem;
}

.msg-text {
  margin: 0.1rem 0 0;
  word-break: break-word;
  white-space: pre-wrap;
}

.composer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.composer input {
  flex: 1;
  min-width: 0;
}

.count {
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  min-width: 2.2rem;
  text-align: right;
}

.count.warn {
  color: var(--warn);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
