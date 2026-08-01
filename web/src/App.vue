<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { me } from './api';
import { authError, busy, signIn, signOut, token } from './auth';
import LoginForm from './components/LoginForm.vue';

/**
 * Оболочка панели: вход, навигация, место под страницу.
 *
 * Сами экраны живут в pages/ и подключены роутером. Данные каждый грузит сам:
 * общий загрузчик наверху означал бы, что журнал ходит за списком продавцов, а
 * карточка продавца — за журналом.
 */
const adminId = ref('');

onMounted(async () => {
  if (!token.value) return;

  // Токен из прошлой сессии мог протухнуть. Проверяем его ДО того, как
  // страница пойдёт за данными, иначе пользователь видит пустую таблицу
  // вместо формы входа.
  try {
    adminId.value = await me(token.value);
  } catch {
    signOut();
  }
});
</script>

<template>
  <LoginForm v-if="!token" :error="authError" :busy="busy" @submit="signIn" />

  <div v-else class="shell">
    <!--
      Сайдбар того же цвета, что и холст, — отличается только границей.
      Другой фон разрезал бы экран на «мир меню» и «мир содержимого», хотя это
      одна поверхность одного инструмента.
    -->
    <aside>
      <div class="brand">
        <span class="title">Панель бота</span>
        <span class="who">id {{ adminId || '—' }}</span>
      </div>

      <nav>
        <RouterLink to="/">Обзор</RouterLink>
        <RouterLink to="/users">Пользователи</RouterLink>
        <RouterLink to="/logs">Журнал действий</RouterLink>
      </nav>

      <button type="button" class="exit" @click="signOut">Выйти</button>
    </aside>

    <main><RouterView /></main>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: var(--sidebar) minmax(0, 1fr);
  min-height: 100vh;
}

aside {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px 12px;
  border-right: 1px solid var(--border);
  /* Меню остаётся на месте при прокрутке длинного журнала: уходить за ним
     вверх ему незачем. */
  position: sticky;
  top: 0;
  height: 100vh;
}

.brand {
  display: flex;
  flex-direction: column;
  padding: 0 10px;
}

.title {
  font-size: 14px;
  font-weight: 600;
}

.who {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/*
 * Пункт меню: сам по себе — просто текст. Активный получает подложку и
 * accent-полосу слева. Цвет тут работает ровно один раз, на текущем разделе, —
 * остальную структуру держат вес и отступы.
 */
nav a {
  position: relative;
  padding: 7px 10px;
  border-radius: 6px;
  color: var(--muted);
  text-decoration: none;
  font-size: 14px;
}

nav a:hover {
  background: var(--surface);
  color: var(--text);
}

nav a.router-link-active {
  background: var(--surface);
  color: var(--text);
  font-weight: 500;
}

nav a.router-link-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
}

.exit {
  /* Прижат к низу: это выход, а не пункт навигации. */
  margin-top: auto;
  font-size: 13px;
  padding: 7px 10px;
  text-align: left;
  background: none;
  border-color: transparent;
  color: var(--muted);
}

.exit:hover:not(:disabled) {
  background: var(--surface);
  border-color: transparent;
  color: var(--text);
}

main {
  min-width: 0;
  /* Ограничение ширины, а не растяжка на весь монитор: строка журнала длиной
     в два метра нечитаема, а таблица внутри прокручивается сама. */
  max-width: 1280px;
  padding: 24px 24px 64px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* На узком экране колонка разворачивается в шапку: 232 пикселя меню на
   телефоне — это половина ширины под навигацию, которой пользуются раз. */
@media (max-width: 720px) {
  .shell {
    grid-template-columns: minmax(0, 1fr);
  }

  aside {
    position: static;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 12px;
    overflow-x: auto;
  }

  .brand {
    display: none;
  }

  nav {
    flex-direction: row;
  }

  nav a {
    white-space: nowrap;
  }

  nav a.router-link-active::before {
    left: 6px;
    right: 6px;
    top: auto;
    bottom: 0;
    width: auto;
    height: 2px;
  }

  main {
    padding: 16px 12px 48px;
  }
}
</style>
