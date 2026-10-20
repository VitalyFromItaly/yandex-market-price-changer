import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { installAuth } from './modules/auth/composables/installAuth.auth';
import { router } from './router';
import { resettableStoresPlugin } from './shared/store';
import './assets/index.css';

const pinia = createPinia().use(resettableStoresPlugin);
const app = createApp(App).use(pinia);
// Токен в запросы и реакция на 401 — до роутера: гвард первой навигации уже ходит в /auth/me.
installAuth(router, pinia);
app.use(router).mount('#app');
