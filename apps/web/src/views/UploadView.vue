<script setup>
import { computed, ref } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();

const title = ref("");
const artist = ref("");
const uploadedBy = ref("");
const file = ref(null);
const status = ref("");
const fileInput = ref(null);
const isDragActive = ref(false);
const uploadedSong = ref(null);

const selectedFileSummary = computed(() => {
  if (!file.value) {
    return "Drop an audio file here or click Browse.";
  }

  const sizeMb = (file.value.size / (1024 * 1024)).toFixed(2);
  return `${file.value.name} (${sizeMb} MB)`;
});

const uploadedSongDetails = computed(() => {
  if (!uploadedSong.value) return [];
  return [
    uploadedSong.value.artist ? `Artist: ${uploadedSong.value.artist}` : null,
    uploadedSong.value.album ? `Album: ${uploadedSong.value.album}` : null,
    uploadedSong.value.genre ? `Genre: ${uploadedSong.value.genre}` : null,
    uploadedSong.value.year ? `Year: ${uploadedSong.value.year}` : null,
    Number.isFinite(uploadedSong.value.duration) ? `Duration: ${uploadedSong.value.duration}s` : null
  ].filter(Boolean);
});

function setSelectedFile(nextFile) {
  file.value = nextFile || null;
  uploadedSong.value = null;
}

function onFileChange(event) {
  setSelectedFile(event.target.files?.[0] || null);
}

function openFilePicker() {
  fileInput.value?.click();
}

function onDragOver() {
  isDragActive.value = true;
}

function onDragLeave() {
  isDragActive.value = false;
}

function onDrop(event) {
  isDragActive.value = false;
  const droppedFile = event.dataTransfer?.files?.[0] || null;
  setSelectedFile(droppedFile);
}

async function upload() {
  if (!file.value) {
    status.value = "Choose an audio file first.";
    return;
  }

  const formData = new FormData();
  formData.append("file", file.value);
  formData.append("title", title.value);
  formData.append("artist", artist.value);
  formData.append("uploadedBy", uploadedBy.value);

  status.value = "Uploading...";

  try {
    const song = await store.uploadSong(formData);
    uploadedSong.value = song || null;
    status.value = "Upload complete. Embedded tags scanned.";
    title.value = "";
    artist.value = "";
    uploadedBy.value = "";
    file.value = null;
    if (fileInput.value) fileInput.value.value = "";
  } catch {
    status.value = store.errorMessage || "Upload failed.";
  }
}
</script>

<template>
  <section class="card">
    <h2>Upload Song</h2>

    <div
      class="upload-dropzone"
      :class="{ 'upload-dropzone-active': isDragActive }"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <p><strong>Drag and drop audio here</strong></p>
      <p><small>{{ selectedFileSummary }}</small></p>
      <button class="button" type="button" @click="openFilePicker" :disabled="store.loading.upload">Browse</button>
      <input ref="fileInput" class="upload-hidden-input" type="file" accept=".mp3,.wav,.m4a,.flac,audio/*" @change="onFileChange" />
    </div>

    <p><input class="input" v-model="title" placeholder="Title, optional" /></p>
    <p><input class="input" v-model="artist" placeholder="Artist, optional" /></p>
    <p><input class="input" v-model="uploadedBy" placeholder="Your name, optional" /></p>

    <button class="button" @click="upload" :disabled="store.loading.upload">
      {{ store.loading.upload ? "Uploading..." : "Upload" }}
    </button>

    <div v-if="uploadedSong" class="upload-preview">
      <img v-if="uploadedSong.artworkUrl" :src="uploadedSong.artworkUrl" alt="Album art" class="upload-artwork" />
      <div>
        <p><strong>{{ uploadedSong.title }}</strong></p>
        <p v-for="detail in uploadedSongDetails" :key="detail"><small>{{ detail }}</small></p>
      </div>
    </div>

    <p>{{ status || "Allowed file types: .mp3 .wav .m4a .flac" }}</p>
  </section>
</template>
