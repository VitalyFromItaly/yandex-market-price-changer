<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import type { IActionLogRow, ILogsQuery } from './api';

import { ApiError, clearToken, fetchLogs, loadToken, login, me, saveToken } from './api';
import FiltersPanel from './components/FiltersPanel.vue';
import LoginForm from './components/LoginForm.vue';
import LogTable from './components/LogTable.vue';
import MessageModal from './components/MessageModal.vue';

const REFRESH_MS = 10_000;

const token = ref<string | null>(loadToken());
const authError = ref('');
const loadError = ref('');
const busy = ref(false);
const loading = ref(false);
const autoRefresh = ref(false);

const rows = ref<IActionLogRow[]>([]);
/** Открытая запись; null — модалка закрыта. */
const selected = ref<IActionLogRow | null>(null);
const total = ref(0);
const skip = ref(0);

function emptyFilters(): ILogsQuery {
  return { telegramUserId: '', kind: '', direction: '', since: '', until: '', limit: 100 };
}

const filters = reactive<ILogsQuery>(emptyFilters());

const pageEnd = computed(() => Math.min(skip.value + rows.value.length, total.value));
const hasPrev = computed(() => skip.value > 0);
const hasNext = computed(() => pageEnd.value < total.value);

let timer: number | undefined;

onMounted(async () => {
  if (!token.value) return;

  // Токен из прошлой сессии мог протухнуть. Проверяем его ДО загрузки данных,
  // иначе пользователь видит пустую таблицу вместо формы входа.
  try {
    await me(token.value);
    await load();
  } catch {
    signOut();
  }
});

onBeforeUnmount(stopTimer);

async function onLogin(id: string, password: string): Promise<void> {
  busy.value = true;
  authError.value = '';

  try {
    const issued = await login(id, password);
    saveToken(issued);
    token.value = issued;
    await load();
  } catch (error) {
    authError.value = (error as ApiError).message;
  } finally {
    busy.value = false;
  }
}

function signOut(): void {
  clearToken();
  token.value = null;
  rows.value = [];
  total.value = 0;
  selected.value = null;
  stopTimer();
  autoRefresh.value = false;
}

async function load(): Promise<void> {
  if (!token.value) return;

  loading.value = true;
  loadError.value = '';

  try {
    const response = await fetchLogs(token.value, { ...filters, skip: skip.value });
    rows.value = response.items;
    total.value = response.total;
  } catch (error) {
    const apiError = error as ApiError;
    // Разница принципиальная: протухшая сессия требует входа, сетевой сбой —
    // только повтора. Раньше на любой сбой панель выкидывала на форму входа.
    if (apiError.isAuthError) {
      signOut();
      authError.value = apiError.message;
    } else {
      loadError.value = apiError.message;
    }
  } finally {
    loading.value = false;
  }
}

/** Смена фильтров всегда возвращает на первую страницу. */
async function apply(): Promise<void> {
  skip.value = 0;
  await load();
}

async function reset(): Promise<void> {
  Object.assign(filters, emptyFilters());
  await apply();
}

async function move(direction: -1 | 1): Promise<void> {
  const limit = filters.limit ?? 100;
  skip.value = Math.max(0, skip.value + direction * limit);
  await load();
}

function toggleAutoRefresh(): void {
  autoRefresh.value = !autoRefresh.value;
  if (!autoRefresh.value) return stopTimer();

  // setInterval, а не рекурсивный setTimeout: запрос лёгкий, а пропущенный
  // из-за медленного ответа тик здесь ничего не ломает — следующий покажет
  // то же самое состояние.
  timer = window.setInterval(() => void load(), REFRESH_MS);
}

function stopTimer(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}
</script>

<template>
  <LoginForm v-if="!token" :error="authError" :busy="busy" @submit="onLogin" />

  <main v-else>
    <header>
      <h1>Журнал действий</h1>
      <div class="tools">
        <button type="button" :disabled="loading" @click="load">
          {{ loading ? 'Загрузка…' : 'Обновить' }}
        </button>
        <button type="button" :class="{ primary: autoRefresh }" @click="toggleAutoRefresh">
          Авто {{ autoRefresh ? 'вкл' : 'выкл' }}
        </button>
        <button type="button" @click="signOut">Выйти</button>
      </div>
    </header>

    <FiltersPanel v-model="filters" @apply="apply" @reset="reset" />

    <p v-if="loadError" class="error">{{ loadError }}</p>

    <LogTable :rows="rows" @select="selected = $event" />

    <MessageModal v-if="selected" :row="selected" @close="selected = null" />

    <footer>
      <span class="muted">
        {{ total ? `${skip + 1}–${pageEnd} из ${total}` : 'Записей нет' }}
      </span>
      <span class="pager">
        <button type="button" :disabled="!hasPrev || loading" @click="move(-1)">Назад</button>
        <button type="button" :disabled="!hasNext || loading" @click="move(1)">Вперёд</button>
      </span>
    </footer>
  </main>
</template>

<style scoped>
main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

h1 {
  margin: 0;
  font-size: 20px;
}

.tools {
  display: flex;
  gap: 8px;
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pager {
  display: flex;
  gap: 8px;
}

.muted {
  color: var(--muted);
  font-size: 13px;
}
</style>
