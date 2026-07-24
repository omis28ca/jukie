import { createRouter, createWebHistory } from "vue-router";
import DashboardView from "../views/DashboardView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "now-playing", component: DashboardView },
    { path: "/library", name: "library", component: DashboardView },
    { path: "/upload", name: "upload", component: DashboardView },
    { path: "/admin", name: "admin", component: DashboardView },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});
