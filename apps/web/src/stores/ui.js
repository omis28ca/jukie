import { defineStore } from 'pinia';

let toastId = 0;

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [],
    sidebarOpen: false,
    connected: false
  }),
  actions: {
    setConnected(value) {
      this.connected = Boolean(value);
    },
    toggleSidebar(force) {
      this.sidebarOpen = typeof force === 'boolean' ? force : !this.sidebarOpen;
    },
    closeSidebar() {
      this.sidebarOpen = false;
    },
    push(message, type = 'info', timeout = 5000) {
      const text = typeof message === 'string' ? message : message?.message || 'Something happened';
      const id = ++toastId;
      this.toasts.push({ id, message: text, type });
      if (timeout > 0) {
        setTimeout(() => this.dismiss(id), timeout);
      }
      return id;
    },
    success(message) {
      return this.push(message, 'success');
    },
    error(message) {
      return this.push(message, 'error', 7000);
    },
    info(message) {
      return this.push(message, 'info');
    },
    dismiss(id) {
      this.toasts = this.toasts.filter((toast) => toast.id !== id);
    }
  }
});
