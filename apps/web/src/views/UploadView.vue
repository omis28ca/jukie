<script setup>
import { ref } from "vue";
import { useJukeboxStore } from "../stores/jukebox";

const store = useJukeboxStore();

const title = ref("");
const artist = ref("");
const uploadedBy = ref("");
const file = ref(null);
const status = ref("");
const fileInput = ref(null);

function onFileChange(event) {
  file.value = event.target.files?.[0] || null;
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
    await store.uploadSong(formData);
    status.value = "Upload complete.";
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

    <p><input class="input" v-model="title" placeholder="Title, optional" /></p>
    <p><input class="input" v-model="artist" placeholder="Artist, optional" /></p>
    <p><input class="input" v-model="uploadedBy" placeholder="Your name, optional" /></p>
    <p><input ref="fileInput" type="file" accept=".mp3,.wav,.m4a,.flac,audio/*" @change="onFileChange" /></p>

    <button class="button" @click="upload" :disabled="store.loading.upload">
      {{ store.loading.upload ? "Uploading..." : "Upload" }}
    </button>

    <p>{{ status || "Allowed file types: .mp3 .wav .m4a .flac" }}</p>
  </section>
</template>
