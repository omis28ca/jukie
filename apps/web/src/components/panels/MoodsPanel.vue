<script setup>
import { computed, onMounted, ref } from 'vue';
import MoodCard from '../MoodCard.vue';
import SongCard from '../SongCard.vue';
import { useMoodsStore } from '../../stores/moods';
import { useSessionStore } from '../../stores/session';
import { useLibraryStore } from '../../stores/library';

const emit = defineEmits(['open-panel']);
const moods = useMoodsStore();
const session = useSessionStore();
const library = useLibraryStore();

const openId = ref('');
const editing = ref(false);
const saving = ref(false);
const draftSongs = ref([]);
const songSearch = ref('');
const opening = ref(false);
const availableSongs = computed(() => {
  const ids = new Set(draftSongs.value.map((song) => song.id));
  const term = songSearch.value.trim().toLowerCase();
  return library.songs.filter((song) => !ids.has(song.id) &&
    [song.title, song.artist, song.album].filter(Boolean).join(' ').toLowerCase().includes(term));
});

onMounted(() => {
  if (!moods.loaded) moods.fetch();
});

async function open(mood) {
  editing.value = false;
  if (openId.value === mood.id) {
    openId.value = '';
    return;
  }
  openId.value = mood.id;
  opening.value = true;
  try {
    await moods.fetchOne(mood.id);
  } catch {
    openId.value = '';
  } finally {
    opening.value = false;
  }
}

function editSongs() {
  draftSongs.value = [...(moods.detail?.songs || [])];
  songSearch.value = '';
  editing.value = true;
  if (!library.loaded) library.fetch();
}

function moveSong(index, offset) {
  const songs = [...draftSongs.value];
  const [song] = songs.splice(index, 1);
  songs.splice(index + offset, 0, song);
  draftSongs.value = songs;
}

async function saveSongs() {
  saving.value = true;
  try {
    await moods.updateSongs(openId.value, moods.detail.name, draftSongs.value.map((song) => song.id));
    editing.value = false;
  } catch {
    /* toast already raised */
  } finally {
    saving.value = false;
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
            :disabled="saving || opening"
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
        <button v-if="session.isAdmin && !editing && !moods.detailLoading" class="btn btn-sm" type="button" @click="editSongs">
          Edit songs
        </button>
      </div>
      <fieldset v-if="editing && session.isAdmin" class="song-editor stack panel" :disabled="saving">
        <legend>Edit mood songs</legend>
        <ol class="stack">
          <li v-for="(song, index) in draftSongs" :key="song.id" class="row">
            <span class="editor-title">{{ index + 1 }}. {{ song.title }} — {{ song.artist || 'Unknown artist' }}</span>
            <button class="btn btn-sm" type="button" :disabled="index === 0" :aria-label="`Move ${song.title} up`" @click="moveSong(index, -1)">Up</button>
            <button class="btn btn-sm" type="button" :disabled="index === draftSongs.length - 1" :aria-label="`Move ${song.title} down`" @click="moveSong(index, 1)">Down</button>
            <button class="btn btn-sm btn-danger" type="button" :aria-label="`Remove ${song.title} from mood`" @click="draftSongs.splice(index, 1)">Remove</button>
          </li>
        </ol>
        <p v-if="!draftSongs.length" class="muted">No songs selected. Saving will empty this mood.</p>
        <label for="mood-song-search">Add songs from the library</label>
        <input id="mood-song-search" v-model="songSearch" type="search" placeholder="Search library…" />
        <p v-if="library.loading" class="muted">Loading library…</p>
        <ul class="available-songs stack">
          <li v-for="song in availableSongs" :key="song.id" class="row">
            <span class="editor-title">{{ song.title }} — {{ song.artist || 'Unknown artist' }}</span>
            <button class="btn btn-sm" type="button" :aria-label="`Add ${song.title} to mood`" @click="draftSongs.push(song)">Add</button>
          </li>
        </ul>
        <div class="row">
          <button class="btn btn-primary" type="button" @click="saveSongs">{{ saving ? 'Saving…' : 'Save songs' }}</button>
          <button class="btn" type="button" @click="editing = false">Cancel</button>
        </div>
      </fieldset>
      <div v-else-if="moods.detailLoading" class="empty">Loading songs…</div>
      <div v-else-if="!moods.detail?.songs?.length" class="empty">This mood has no songs yet.</div>
      <div v-else class="card-grid">
        <SongCard v-for="song in moods.detail.songs" :key="song.id" :song="song" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.song-editor {
  min-width: 0;
}

.editor-title {
  flex: 1;
  min-width: 120px;
  overflow-wrap: anywhere;
}

.available-songs {
  max-height: 300px;
  overflow-y: auto;
}

.mood-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.details-btn {
  width: 100%;
}
</style>
