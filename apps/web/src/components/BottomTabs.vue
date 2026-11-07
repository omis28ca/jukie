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
    <RouterLink to="/" class="nav-brand" aria-label="IrDJ home">
      <span class="brand-mark" aria-hidden="true">ir</span>
      <span class="brand-copy">
        <strong>IrDJ</strong>
        <span>THE LIVING ROOM</span>
      </span>
    </RouterLink>
    <p class="nav-label">YOUR SPACE</p>
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
  top: 0;
  bottom: 0;
  z-index: 96;
  display: flex;
  width: var(--rail-w);
  flex-direction: column;
  gap: 0.4rem;
  padding: 1.6rem 1rem;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background: #141511;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin: 0.2rem 0 3.2rem 0.35rem;
  color: var(--text);
  text-decoration: none;
}

.nav-brand:hover {
  text-decoration: none;
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 14px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 1.05rem;
  font-weight: 850;
  letter-spacing: -0.08em;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.brand-copy strong {
  font-size: 1rem;
  letter-spacing: -0.03em;
}

.brand-copy span,
.nav-label {
  color: var(--text-faint);
  font-size: 0.62rem;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.nav-label {
  margin: 0 0.8rem 0.65rem;
}

.tab {
  display: flex;
  min-height: 48px;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0.85rem;
  padding: 0 0.85rem;
  border-radius: 12px;
  color: #a4a69b;
  font-size: 0.87rem;
  font-weight: 620;
  text-decoration: none;
  transition: background 0.16s ease, color 0.16s ease;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.045);
  color: var(--text);
  text-decoration: none;
}

.tab.active {
  background: rgba(201, 243, 106, 0.12);
  color: var(--accent);
}

.tab-icon {
  position: relative;
  display: grid;
  width: 24px;
  place-items: center;
  font-size: 1.15rem;
  line-height: 1;
}

.tab-label {
  flex: 1;
}

.tab-count {
  position: absolute;
  top: -0.45rem;
  right: -0.65rem;
  font-size: 0.6rem;
  font-weight: 650;
  background: var(--accent);
  color: var(--accent-ink);
  border-radius: 999px;
  padding: 0.05rem 0.35rem;
}

.tab-dot {
  position: absolute;
  top: -0.3rem;
  right: -0.35rem;
  color: var(--accent);
  font-size: 0.5rem;
}

@media (max-width: 900px) {
  .tabbar {
    top: auto;
    right: 0;
    bottom: 0;
    width: 100%;
    height: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
    flex-direction: row;
    justify-content: space-around;
    gap: 0;
    padding: 0.3rem 0.35rem env(safe-area-inset-bottom, 0px);
    border-top: 1px solid var(--border);
    border-right: 0;
    background: rgba(20, 21, 17, 0.96);
    backdrop-filter: blur(20px);
  }

  .nav-brand,
  .nav-label {
    display: none;
  }

  .tab {
    min-width: 0;
    min-height: 48px;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: 0.16rem;
    padding: 0.2rem;
    border-radius: 10px;
    font-size: 0.66rem;
  }

  .tab-icon {
    font-size: 1.1rem;
  }
}
</style>
