import { createRouter, createWebHistory } from "vue-router";
import NowPlayingView from "../views/NowPlayingView.vue";
import LibraryView from "../views/LibraryView.vue";
import UploadView from "../views/UploadView.vue";
import AdminView from "../views/AdminView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: NowPlayingView },
    { path: "/library", component: LibraryView },
    { path: "/upload", component: UploadView },
    { path: "/admin", component: AdminView }
  ]
});
