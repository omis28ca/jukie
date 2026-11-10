<script setup>
import { onMounted, ref } from 'vue';
import MoodCard from '../MoodCard.vue';
import SongCard from '../SongCard.vue';
import { useMoodsStore } from '../../stores/moods';
import { useSessionStore } from '../../stores/session';

const emit = defineEmits(['open-panel']);
const moods = useMoodsStore();
const session = useSessionStore();

const openId = ref('');

onMounted(() => {
  if (!moods.loaded) moods.fetch();
});

async function open(mood) {
  if (openId.value === mood.id) {
    openId.value = '';
    return;
  }
  openId.value = mood.id;
  try {
    await moods.fetchOne(mood.id);
  } catch {
    openId.value = '';
  }
}
</script>

<template>
  <div>
    <section class="section">
      <div class="section-head">
        <h2>Moods</h2>
        <span class="sub">{{ moods.moods.length }} playlists</span>
      </div>

      <div v-if="moods.loading && !moods.loaded" class="empty">Loading moods…</div>
      <div v-else-if="!moods.moods.length" class="empty">
        No moods yet.
        <template v-if="session.isAdmin">
          Create one in <button class="btn btn-sm" type="button" @click="emit('open-panel', 'admin')">Admin</button>.
        </template>
        <template v-else>An admin can create them from the Admin drawer.</template>
      </div>
      <div v-else class="card-grid">
        <div v-for="mood in moods.moods" :key="mood.id" class="mood-wrap">
          <MoodCard :mood="mood" />
          <button
            class="btn btn-sm details-btn"
            type="button"
            :aria-expanded="openId === mood.id"
            :aria-label="`Show the songs in ${mood.name}`"
            @click="open(mood)"
          >
            {{ openId === mood.id ? 'Hide songs' : 'Show songs' }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="openId" class="section">
      <div class="section-head">
        <h2>{{ moods.detail?.name || 'Mood' }}</h2>
        <span class="sub">{{ moods.detail?.songs?.length || 0 }} songs</span>
      </div>
      <div v-if="moods.detailLoading" class="empty">Loading songs…</div>
      <div v-else-if="!moods.detail?.songs?.length" class="empty">This mood has no songs yet.</div>
      <div v-else class="card-grid">
        <SongCard v-for="song in moods.detail.songs" :key="song.id" :song="song" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.mood-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.details-btn {
  width: 100%;
}
</style>
