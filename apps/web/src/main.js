import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './styles.css';
import { configureAuth } from './lib/api';
import { useSessionStore } from './stores/session';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

const session = useSessionStore(pinia);
configureAuth({
  name: () => session.name,
  pin: () => session.pin
});

app.mount('#app');
