<script setup>
import { computed, ref } from "vue";
import { useJukeboxStore } from "../stores/jukebox";
import { formatDuration, getSongArtworkUrl, getSongCoverStyle, getSongInitials } from "../utils/media";

const store = useJukeboxStore();
const fileInput = ref(null);
const selectedFile = ref(null);
const dragging = ref(false);
const title = ref("");
const artist = ref("");
const uploadedBy = ref(localStorage.getItem("jukebox-requester-name") || "");
const localStatus = ref("");
const uploadedSong = ref(null);

const fileSize = computed(() => selectedFile.value ? `${(selectedFile.value.size / 1024 / 1024).toFixed(1)} MB` : "");
const uploadedDetails = computed(() => {
  const song = uploadedSong.value;
  if (!song) return "";
  return [song.album, song.genre, song.year, song.duration ? formatDuration(song.duration) : null].filter(Boolean).join(" · ");
});

function chooseFile(file) {
  selectedFile.value = file || null;
  uploadedSong.value = null;
  localStatus.value = "";
}

async function upload() {
  if (!selectedFile.value) {
    localStatus.value = "Choose an audio or video file first.";
    return;
  }
  const formData = new FormData();
  formData.append("file", selectedFile.value);
  formData.append("title", title.value);
  formData.append("artist", artist.value);
  formData.append("uploadedBy", uploadedBy.value);
  localStatus.value = "Uploading and reading embedded details…";
  try {
    uploadedSong.value = await store.uploadSong(formData);
    localStatus.value = "Upload complete — it’s ready to queue.";
    selectedFile.value = null;
    title.value = "";
    artist.value = "";
    if (fileInput.value) fileInput.value.value = "";
  } catch {
    localStatus.value = store.errorMessage || "Upload failed. Please try again.";
  }
}
</script>

<template>
  <form class="mobile-upload-form" @submit.prevent="upload">
    <section class="upload-picker" :class="{ dragging, selected: selectedFile }" @dragenter.prevent="dragging = true" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="dragging = false; chooseFile($event.dataTransfer?.files?.[0])">
      <template v-if="selectedFile">
        <span class="upload-file-icon" aria-hidden="true">♫</span>
        <div><strong>{{ selectedFile.name }}</strong><span>{{ fileSize }} · Ready to upload</span></div>
        <button type="button" aria-label="Remove selected file" @click="chooseFile(null)">×</button>
      </template>
      <template v-else>
        <span class="upload-main-icon" aria-hidden="true">↑</span>
        <h2>Add music to the room</h2>
        <p>Choose an audio or MP4 video file. We’ll read its title, artist and artwork automatically.</p>
        <button class="button button-primary" type="button" :disabled="store.loading.upload" @click="fileInput?.click()">Choose a file</button>
        <small>MP3, MP4, WAV, M4A or FLAC</small>
      </template>
      <input ref="fileInput" class="visually-hidden" type="file" accept=".mp3,.mp4,.wav,.m4a,.flac,audio/*,video/mp4" @change="chooseFile($event.target.files?.[0])" />
    </section>

    <section class="upload-details-card">
      <header><div><h3>Track details</h3><p>Optional — embedded metadata is used when these are blank.</p></div><span>Optional</span></header>
      <label class="field"><span>Title</span><input v-model="title" class="input" placeholder="Use embedded title" /></label>
      <label class="field"><span>Artist</span><input v-model="artist" class="input" placeholder="Use embedded artist" /></label>
      <label class="field"><span>Uploaded by</span><input v-model="uploadedBy" class="input" maxlength="40" placeholder="Your name" /></label>
    </section>

    <button class="button button-primary button-wide upload-submit" type="submit" :disabled="store.loading.upload || !selectedFile">{{ store.loading.upload ? "Uploading…" : "Upload to jukebox" }}</button>
    <p v-if="localStatus" class="upload-status" aria-live="polite">{{ localStatus }}</p>

    <article v-if="uploadedSong" class="upload-success">
      <div class="media-cover" :style="getSongCoverStyle(uploadedSong)"><img v-if="getSongArtworkUrl(uploadedSong)" :src="getSongArtworkUrl(uploadedSong)" alt="" /><span v-else>{{ getSongInitials(uploadedSong) }}</span></div>
      <div><span class="section-kicker">Ready in the library</span><h3>{{ uploadedSong.title }}</h3><p>{{ uploadedSong.artist || "Unknown artist" }}</p><small>{{ uploadedDetails || "Metadata scan complete" }}</small></div>
      <span aria-hidden="true">✓</span>
    </article>
  </form>
</template>
