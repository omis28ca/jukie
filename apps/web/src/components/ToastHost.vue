<script setup>
import { useUiStore } from '../stores/ui';

const ui = useUiStore();
</script>

<template>
  <div class="toast-host" role="region" aria-live="polite" aria-label="Notifications">
    <TransitionGroup name="toast">
      <div v-for="toast in ui.toasts" :key="toast.id" class="toast" :class="`toast-${toast.type}`">
        <span class="toast-msg">{{ toast.message }}</span>
        <button class="toast-close" aria-label="Dismiss notification" @click="ui.dismiss(toast.id)">
          ✕
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: 16px;
  bottom: calc(var(--player-h) + 16px);
  z-index: 120;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(360px, calc(100vw - 32px));
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem 0.8rem;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--text-faint);
  box-shadow: var(--shadow);
  font-size: 0.87rem;
}

.toast-error {
  border-left-color: var(--danger);
}

.toast-success {
  border-left-color: var(--ok);
}

.toast-info {
  border-left-color: var(--accent);
}

.toast-msg {
  flex: 1;
  word-break: break-word;
}

.toast-close {
  color: var(--text-faint);
  font-size: 0.8rem;
  line-height: 1;
  padding: 2px 4px;
}

.toast-close:hover {
  color: var(--text);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
