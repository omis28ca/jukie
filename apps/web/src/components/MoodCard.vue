<script setup>
import { ref } from 'vue';
import { useMoodsStore } from '../stores/moods';

const props = defineProps({
  mood: { type: Object, required: true }
});

const moods = useMoodsStore();
const busy = ref(false);

async function select() {
  busy.value = true;
  try {
    await moods.select(props.mood.id);
  } catch {
    /* toast already raised */
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <article class="mood-card" :class="{ active: moods.activeMoodId === mood.id }">
    <button
      class="mood-hit"
      type="button"
      :disabled="busy"
      :aria-label="`Play the ${mood.name} mood (${mood.songCount || 0} songs)`"
      @click="select"
    >
      <span class="mood-art" aria-hidden="true">{{ (mood.name || '?').slice(0, 2).toUpperCase() }}</span>
      <span class="mood-meta">
        <span class="mood-name truncate">{{ mood.name }}</span>
        <span class="mood-count">{{ mood.songCount || 0 }} songs</span>
      </span>
    </button>
  </article>
</template>

<style scoped>
.mood-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.mood-card.active {
  border-color: var(--accent);
}

.mood-hit {
  display: block;
  width: 100%;
  padding: 0.6rem;
  text-align: left;
}

.mood-hit:hover:not(:disabled) .mood-art {
  filter: brightness(1.15);
}

.mood-art {
  display: grid;
  place-items: center;
  aspect-ratio: 1 / 1;
  width: 100%;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, #2f4f4b, #1b1b1b);
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.04em;
}

.mood-meta {
  display: block;
  margin-top: 0.45rem;
  min-width: 0;
}

.mood-name {
  display: block;
  font-size: 0.88rem;
  font-weight: 600;
}

.mood-count {
  display: block;
  font-size: 0.75rem;
  color: var(--text-dim);
}
</style>
