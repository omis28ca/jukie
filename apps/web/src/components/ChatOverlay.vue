<script setup>
import { computed, ref } from 'vue';
import { useChatStore } from '../stores/chat';
import { useUiStore } from '../stores/ui';

const chat = useChatStore();
const ui = useUiStore();
const minimized = ref(false);
const recentMessages = computed(() => chat.messages.slice(-3));
</script>

<template>
  <aside v-if="!ui.homePanel" class="chat-overlay" aria-label="Room chat preview">
    <div v-if="!minimized" class="chat-preview">
      <div class="preview-heading">
        <strong>Room chat</strong>
        <button class="btn btn-sm btn-ghost" type="button" aria-label="Minimize chat preview" @click="minimized = true">
          Hide
        </button>
      </div>
      <div class="preview-messages" role="log" aria-live="polite" aria-relevant="additions text">
        <p v-if="!recentMessages.length" class="muted">No messages yet. Say hello!</p>
        <p v-for="message in recentMessages" :key="message.id" class="preview-message">
          <strong>{{ message.name || 'Guest' }}</strong>
          <span>{{ message.body }}</span>
        </p>
      </div>
    </div>
    <div class="overlay-actions">
      <button
        v-if="minimized"
        class="btn btn-sm"
        type="button"
        aria-label="Show recent room messages"
        @click="minimized = false"
      >
        Show messages
      </button>
      <button
        class="btn btn-primary"
        type="button"
        aria-haspopup="dialog"
        aria-controls="home-drawer"
        @click="ui.homePanel = 'chat'"
      >
        Open chat · {{ chat.onlineCount }} online
      </button>
    </div>
  </aside>
</template>

<style scoped>
.chat-overlay {
  position: fixed;
  right: max(1rem, env(safe-area-inset-right));
  bottom: max(1rem, env(safe-area-inset-bottom));
  z-index: 70;
  width: min(340px, calc(100vw - 2rem));
}

.chat-preview {
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  box-shadow: var(--shadow);
}

.preview-heading,
.overlay-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.overlay-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.preview-messages {
  max-height: min(180px, 25dvh);
  overflow-y: auto;
  overflow-wrap: anywhere;
  font-size: 0.82rem;
}

.preview-message {
  display: flex;
  flex-direction: column;
  margin: 0.5rem 0 0;
}

.preview-message strong {
  color: var(--accent);
}

.preview-message span {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
}
</style>
