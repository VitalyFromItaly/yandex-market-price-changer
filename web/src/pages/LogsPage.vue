<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import type { IActionLogRow, ILogsQuery, IUserRow } from '../api';

import { fetchLogs, fetchUsers } from '../api';
import { describeError, token } from '../auth';
import FiltersPanel from '../components/FiltersPanel.vue';
import LogTable from '../components/LogTable.vue';
import MessageModal from '../components/MessageModal.vue';
import { logUserOptions } from '../users.domain';

/**
 * Один экран на две вкладки. `junk=true` — это «Мусор»: те же таблица и модалка,
 * но выборка жёстко по `source=scanner` (404-зонды сканеров секретов), а
 * фильтры прячутся — фильтровать однородный шум незачем. Роутер переиспользует
 * ЭТОТ ЖЕ компонент для /logs и /junk, поэтому смену вкладки ловим watch'ем.
 */
const props = defineProps<{ junk?: boolean }>();

const REFRESH_MS = 10_000;

const loadError = ref('');
const loading = ref(false);
const autoRefresh = ref(false);

const rows = ref<IActionLogRow[]>([]);
/** Продавцы — только для подписей в фильтре; ошибка их загрузки журнал не ломает. */
const users = ref<IUserRow[]>([]);
/** Открытая запись; null — модалка закрыта. */
const selected = ref<IActionLogRow | null>(null);
const total = ref(0);
const skip = ref(0);

function emptyFilters(): ILogsQuery {
  return {
    telegramUserId: '',
    kind: '',
    direction: '',
    status: '',
    // В «Мусоре» источник зафиксирован сканером; в обычном журнале он пуст, а
    // бэкенд сам прячет из выдачи записи сканеров.
    source: props.junk ? 'scanner' : '',
    since: '',
    until: '',
    limit: 100,
  };
}

const filters = reactive<ILogsQuery>(emptyFilters());

const userOptions = computed(() =>
  logUserOptions(users.value, rows.value, filters.telegramUserId ?? ''),
);

const pageEnd = computed(() => Math.min(skip.value + rows.value.length, total.value));
const hasPrev = computed(() => skip.value > 0);
const hasNext = computed(() => pageEnd.value < total.value);

let timer: number | undefined;

onMounted(() => {
  void load();
  void loadUsers();
});
// Таймер снимается при уходе со страницы: под роутером компонент размонтируется
// при переходе в «Пользователи», и живой setInterval продолжал бы дёргать
// /api/logs с чужого экрана.
onBeforeUnmount(stopTimer);

// /logs ↔ /junk — один и тот же компонент, onMounted при переключении не
// сработает. Сбрасываем фильтры под новую вкладку и перезагружаем.
watch(
  () => props.junk,
  async () => {
    Object.assign(filters, emptyFilters());
    skip.value = 0;
    await load();
    await loadUsers();
  },
);

async function load(): Promise<void> {
  if (!token.value) return;

  loading.value = true;
  loadError.value = '';

  try {
    const response = await fetchLogs(token.value, { ...filters, skip: skip.value });
    rows.value = response.items;
    total.value = response.total;
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

/**
 * Список продавцов — отдельным запросом, а не внутри load(): автообновление раз
 * в 10 секунд не должно тянуть его заново, состав продавцов за это время не
 * меняется. На «Мусоре» фильтров нет вовсе — там запрос не нужен.
 *
 * Ошибка гасится: подписи в фильтре важны, но не настолько, чтобы из-за них не
 * открылся журнал. Без списка варианты соберутся из самих записей.
 */
async function loadUsers(): Promise<void> {
  if (!token.value || props.junk || users.value.length) return;

  try {
    users.value = await fetchUsers(token.value);
  } catch {
    users.value = [];
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
  <header>
    <h1>{{ junk ? 'Мусор' : 'Журнал действий' }}</h1>
    <div class="tools">
      <button type="button" :disabled="loading" @click="load">
        {{ loading ? 'Загрузка…' : 'Обновить' }}
      </button>
      <button type="button" :class="{ primary: autoRefresh }" @click="toggleAutoRefresh">
        Авто {{ autoRefresh ? 'вкл' : 'выкл' }}
      </button>
    </div>
  </header>

  <p v-if="junk" class="muted note">
    Внешние сканеры, ищущие утёкшие секреты (<code>/.env</code>, <code>/.git/config</code>,
    <code>/.aws/credentials</code>). Таких файлов у нас нет — каждый запрос получает 404.
    Держим отдельно, чтобы не засоряли журнал.
  </p>

  <FiltersPanel
    v-if="!junk"
    v-model="filters"
    :users="userOptions"
    @apply="apply"
    @reset="reset"
  />

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
</template>

<style scoped>
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.01em;
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

.note {
  margin: 0;
  line-height: 1.5;
}

.note code {
  font-size: 12px;
  padding: 1px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
</style>
