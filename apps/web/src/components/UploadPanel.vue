<script setup>
import { computed, ref } from "vue";
import { useJukeboxStore } from "../stores/jukebox";
import { formatDuration, getSongArtworkUrl, getSongCoverStyle, getSongInitials } from "../utils/media";

const store = useJukeboxStore();
const fileInput = ref(null);
const selectedFile = ref(null);
const isDragActive = ref(false);
const title = ref("");
const artist = ref("");
const uploadedBy = ref("");
const localStatus = ref("");
const uploadedSong = ref(null);

const selectedFileSummary = computed(() => {
  if (!selectedFile.value) return "MP3, WAV, M4A or FLAC";
  const sizeMb = (selectedFile.value.size / (1024 * 1024)).toFixed(2);
  return `${selectedFile.value.name} · ${sizeMb} MB`;
});

const uploadedDetails = computed(() => {
  const song = uploadedSong.value;
  if (!song) return [];
  return [
    song.album,
    song.genre,
    song.year,
    Number.isFinite(Number(song.duration)) ? formatDuration(Number(song.duration)) : null
  ].filter(Boolean);
});

function setSelectedFile(file) {
  selectedFile.value = file || null;
  uploadedSong.value = null;
  localStatus.value = "";
}

function onFileChange(event) {
  setSelectedFile(event.target.files?.[0]);
}

function onDrop(event) {
  isDragActive.value = false;
  setSelectedFile(event.dataTransfer?.files?.[0]);
}

async function upload() {
  if (!selectedFile.value) {
    localStatus.value = "Choose an audio file to continue.";
    return;
  }

  const formData = new FormData();
  formData.append("file", selectedFile.value);
  formData.append("title", title.value);
  formData.append("artist", artist.value);
  formData.append("uploadedBy", uploadedBy.value);
  localStatus.value = "Reading tags and uploading…";

  try {
    uploadedSong.value = await store.uploadSong(formData);
    localStatus.value = "Ready in your library.";
    selectedFile.value = null;
    title.value = "";
    artist.value = "";
    uploadedBy.value = "";
    if (fileInput.value) fileInput.value.value = "";
  } catch {
    localStatus.value = store.errorMessage || "Upload failed.";
  }
}
</script>

<template>
  <form class="panel-form" @submit.prevent="upload">
    <div
      class="upload-dropzone"
      :class="{ 'is-dragging': isDragActive }"
      @dragenter.prevent="isDragActive = true"
      @dragover.prevent="isDragActive = true"
      @dragleave.prevent="isDragActive = false"
      @drop.prevent="onDrop"
    >
      <span class="dropzone-icon" aria-hidden="true">↑</span>
      <strong>{{ selectedFile ? "Track selected" : "Drop an audio track here" }}</strong>
      <span>{{ selectedFileSummary }}</span>
      <button class="button button-secondary" type="button" :disabled="store.loading.upload" @click="fileInput?.click()">
        Browse files
      </button>
      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept=".mp3,.wav,.m4a,.flac,audio/*"
        @change="onFileChange"
      />
    </div>

    <div class="form-grid">
      <label class="field">
        <span>Title override <small>optional</small></span>
        <input v-model="title" class="input" placeholder="Use embedded title" />
      </label>
      <label class="field">
        <span>Artist override <small>optional</small></span>
        <input v-model="artist" class="input" placeholder="Use embedded artist" />
      </label>
    </div>

    <label class="field">
      <span>Uploaded by <small>optional</small></span>
      <input v-model="uploadedBy" class="input" placeholder="Your name" />
    </label>

    <button class="button button-primary button-wide" type="submit" :disabled="store.loading.upload">
      {{ store.loading.upload ? "Uploading…" : "Add to library" }}
    </button>
    <p v-if="localStatus" class="form-status" aria-live="polite">{{ localStatus }}</p>

    <article v-if="uploadedSong" class="upload-result">
      <div class="media-cover media-cover-md" :style="getSongCoverStyle(uploadedSong)">
        <img v-if="getSongArtworkUrl(uploadedSong)" :src="getSongArtworkUrl(uploadedSong)" alt="" />
        <span v-else>{{ getSongInitials(uploadedSong) }}</span>
      </div>
      <div>
        <span class="eyebrow">Upload complete</span>
        <h3>{{ uploadedSong.title }}</h3>
        <p>{{ uploadedSong.artist || "Unknown artist" }}</p>
        <small>{{ uploadedDetails.join(" · ") || "Metadata scan complete" }}</small>
      </div>
    </article>
  </form>
</template>
