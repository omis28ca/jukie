<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import { useQueueStore } from '../stores/queue';
import { initials } from '../lib/format';

const emit = defineEmits(['change-name']);

const route = useRoute();
const session = useSessionStore();
const ui = useUiStore();
const queue = useQueueStore();

const sections = computed(() => [
  {
    title: 'Explore',
    items: [
      { to: '/', label: 'Home', icon: '⌂' },
      { to: '/library', label: 'Library', icon: '♫' },
      { to: '/upload', label: 'Upload', icon: '↑' }
    ]
  },
  {
    title: 'Library',
    items: [{ to: '/moods', label: 'Moods', icon: '☾' }]
  },
  {
    title: 'System',
    items: [{ to: '/admin', label: 'Admin', icon: '⚙' }]
  }
]);

const isActive = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
</script>

<template>
  <div
    class="scrim"
    :class="{ show: ui.sidebarOpen }"
    aria-hidden="true"
    @click="ui.closeSidebar()"
  ></div>

  <aside class="sidebar" :class="{ open: ui.sidebarOpen }" aria-label="Main navigation">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">♪</span>
      <span class="brand-name">Jukie</span>
      <span class="conn" :class="{ on: ui.connected }" :title="ui.connected ? 'Live' : 'Offline'">
        <span class="visually-hidden">{{ ui.connected ? 'Connected' : 'Disconnected' }}</span>
      </span>
    </div>

    <nav class="nav">
      <div v-for="section in sections" :key="section.title" class="nav-section">
        <p class="nav-title">{{ section.title }}</p>
        <ul>
          <li v-for="item in section.items" :key="item.to">
            <RouterLink
              :to="item.to"
              class="nav-link"
              :class="{ active: isActive(item.to) }"
              :aria-current="isActive(item.to) ? 'page' : undefined"
              @click="ui.closeSidebar()"
            >
              <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
              <span v-if="item.to === '/' && queue.count" class="nav-count">{{ queue.count }}</span>
              <span v-if="item.to === '/admin' && session.isAdmin" class="nav-dot" aria-hidden="true"
                >●</span
              >
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>

    <footer class="sidebar-foot">
      <div class="user">
        <span class="avatar" aria-hidden="true">{{ initials(session.name) }}</span>
        <span class="user-name truncate" :title="session.name">{{ session.name || 'Guest' }}</span>
      </div>
      <button class="btn btn-sm btn-ghost change-name" type="button" @click="emit('change-name')">
        Change name
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--sidebar-w);
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
  padding: 1rem 0.75rem calc(var(--player-h) + 0.75rem);
  z-index: 90;
  transition: transform 0.22s ease;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.25rem 0.5rem 1.2rem;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 700;
}

.brand-name {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  flex: 1;
}

.conn {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
}

.conn.on {
  background: var(--ok);
  box-shadow: 0 0 8px rgba(86, 194, 113, 0.6);
}

.nav {
  flex: 1;
  overflow-y: auto;
}

.nav-section + .nav-section {
  margin-top: 1.3rem;
}

.nav-title {
  margin: 0 0 0.4rem;
  padding: 0 0.6rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  font-weight: 650;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.65rem;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 0.9rem;
  font-weight: 550;
  text-decoration: none;
}

.nav-link:hover {
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}

.nav-link.active {
  background: var(--surface-2);
  color: var(--text);
}

.nav-icon {
  width: 18px;
  text-align: center;
  font-size: 1rem;
}

.nav-count {
  margin-left: auto;
  font-size: 0.7rem;
  font-weight: 650;
  background: var(--surface-3);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
}

.nav-dot {
  margin-left: auto;
  color: var(--accent);
  font-size: 0.6rem;
}

.sidebar-foot {
  border-top: 1px solid var(--border);
  padding-top: 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.user {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0 0.3rem;
}

.avatar {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 50%;
  background: var(--surface-3);
  font-size: 0.75rem;
  font-weight: 650;
  color: var(--text-dim);
}

.user-name {
  font-size: 0.88rem;
  font-weight: 600;
}

.change-name {
  justify-content: flex-start;
}

.scrim {
  display: none;
}

@media (max-width: 900px) {
  .sidebar {
    transform: translateX(-100%);
    box-shadow: var(--shadow);
    padding-bottom: 180px;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    z-index: 85;
  }

  .scrim.show {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
