<script setup>
import { useRoute } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useQueueStore } from '../stores/queue';

const route = useRoute();
const session = useSessionStore();
const queue = useQueueStore();

const tabs = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/library', label: 'Library', icon: '♫' },
  { to: '/upload', label: 'Upload', icon: '↑' },
  { to: '/moods', label: 'Moods', icon: '☾' },
  { to: '/admin', label: 'Admin', icon: '⚙' }
];

const isActive = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
</script>

<template>
  <nav class="tabbar" aria-label="Main navigation">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="tab"
      :class="{ active: isActive(tab.to) }"
      :aria-current="isActive(tab.to) ? 'page' : undefined"
    >
      <span class="tab-icon" aria-hidden="true">
        {{ tab.icon }}
        <span v-if="tab.to === '/' && queue.count" class="tab-count">{{ queue.count }}</span>
        <span v-if="tab.to === '/admin' && session.isAdmin" class="tab-dot">●</span>
      </span>
      <span class="tab-label">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 96;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  height: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  color: var(--text-faint);
  font-size: 0.7rem;
  font-weight: 600;
  text-decoration: none;
}

.tab:hover {
  color: var(--text-dim);
  text-decoration: none;
}

.tab.active {
  color: var(--accent);
}

.tab-icon {
  position: relative;
  font-size: 1.2rem;
  line-height: 1;
}

.tab-count {
  position: absolute;
  top: -0.35rem;
  left: 100%;
  margin-left: -0.2rem;
  font-size: 0.6rem;
  font-weight: 650;
  background: var(--surface-3);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 0.05rem 0.35rem;
}

.tab-dot {
  position: absolute;
  top: -0.2rem;
  left: 100%;
  color: var(--accent);
  font-size: 0.5rem;
}
</style>
