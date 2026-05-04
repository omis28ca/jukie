import { createRouter, createWebHistory } from "vue-router";
import NowPlayingView from "../views/NowPlayingView.vue";
import LibraryView from "../views/LibraryView.vue";
import UploadView from "../views/UploadView.vue";
import AdminView from "../views/AdminView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "now-playing", component: NowPlayingView },
    { path: "/library", name: "library", component: LibraryView },
    { path: "/upload", name: "upload", component: UploadView },
    { path: "/admin", name: "admin", component: AdminView }
  ]
});
