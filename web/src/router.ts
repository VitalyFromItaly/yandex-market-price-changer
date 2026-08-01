import { createRouter, createWebHashHistory } from 'vue-router';

import HomePage from './pages/HomePage.vue';
import LogsPage from './pages/LogsPage.vue';
import UserPage from './pages/UserPage.vue';
import UsersPage from './pages/UsersPage.vue';

/**
 * Маршруты панели.
 *
 * История — ХЕШЕВАЯ (`createWebHashHistory`), а не обычная. Причина ровно та,
 * по которой роутера тут раньше не было вовсе: панель раздаётся статикой из
 * `useStaticAssets` (см. main.ts бэкенда), а глобальный префикс Nest — `/api`.
 * При обычной истории обновление страницы на `/users/999/222` ушло бы на
 * сервер, где такого файла нет и такого маршрута нет, — то есть F5 на карточке
 * продавца отдавал бы 404. Это лечится SPA-fallback'ом в раздаче статики, но
 * fallback пришлось бы аккуратно исключать для `/api`, и любая опечатка в нём
 * превращала бы ошибку API в молча отданный index.html. Хеш на сервер не
 * уходит вообще: адрес, кнопка «назад» и перезагрузка работают без единой
 * правки в бэкенде.
 *
 * Ключ карточки — ПАРА (бот, пользователь): запись доступа уникальна именно
 * ею, и один telegramUserId может обслуживаться несколькими ботами.
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/logs', name: 'logs', component: LogsPage },
    { path: '/users', name: 'users', component: UsersPage },
    {
      path: '/users/:botId/:telegramUserId',
      name: 'user',
      component: UserPage,
      // props: true — страница получает botId и telegramUserId аргументами и не
      // лезет в useRoute(): её можно отрисовать без роутера, а данные приходят
      // одним понятным путём.
      props: true,
    },
    // Неизвестный адрес — на обзор, а не в белый экран.
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
