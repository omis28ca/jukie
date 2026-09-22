<script setup>
import { computed, ref, watch } from 'vue';
import { apiUrl } from '../lib/api';
import { initials } from '../lib/format';

const props = defineProps({
  song: { type: Object, default: null },
  size: { type: String, default: '' },
  alt: { type: String, default: '' }
});

const failed = ref(false);

const src = computed(() => {
  if (failed.value) return '';
  const url = props.song?.artworkUrl;
  return url ? apiUrl(url) : '';
});

const label = computed(() => initials(props.song?.title || props.song?.artist || ''));
const altText = computed(
  () => props.alt || (props.song?.title ? `Artwork for ${props.song.title}` : 'Album artwork')
);

watch(
  () => props.song?.id,
  () => {
    failed.value = false;
  }
);
</script>

<template>
  <img
    v-if="src"
    class="art"
    :src="src"
    :alt="altText"
    :style="size ? { width: size, height: size } : null"
    loading="lazy"
    @error="failed = true"
  />
  <div
    v-else
    class="art art-fallback"
    role="img"
    :aria-label="altText"
    :style="size ? { width: size, height: size } : null"
  >
    {{ label }}
  </div>
</template>
