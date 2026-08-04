<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type { IDigestRow, IQueueJobRow, IQueueSummary } from '../api';

import { fetchDigests, fetchQueueJobs, fetchQueues, retryQueueJob } from '../api';
import { describeError, token } from '../auth';

/**
 * Очереди Bull: счётчики, запланированные рассылки и задачи по состояниям.
 *
 * Всё, что видно на странице, приходит с сервера уже очищенным: payload задач —
 * белый список полей (botToken туда не попадает по построению, см.
 * queues.domain.ts на бэкенде).
 */
const REFRESH_MS = 10_000;
const LIMIT = 50;

/** Подписи состояний. Порядок — это порядок вкладок: упавшие важнее всего. */
const STATE_LABEL: Record<string, string> = {
  failed: 'Упавшие',
  delayed: 'Отложенные',
  waiting: 'Ожидают',
  active: 'Активные',
  completed: 'Завершённые',
};
const STATES = Object.keys(STATE_LABEL);

/** Вкладки фильтра: «Все» плюс состояния. В счётчиках карточек «Все» нет —
 * там каждое число уже отвечает за свой срез. */
const STATE_TABS = ['all', ...STATES];
const TAB_LABEL: Record<string, string> = { all: 'Все', ...STATE_LABEL };

/** Подпись состояния в строке таблицы — там задача одна, а не множество. */
const STATE_ROW_LABEL: Record<string, string> = {
  failed: 'упала',
  delayed: 'отложена',
  waiting: 'ждёт',
  active: 'выполняется',
  completed: 'завершена',
};

const loadError = ref('');
const loading = ref(false);
const autoRefresh = ref(false);

const queues = ref<IQueueSummary[]>([]);
const digests = ref<IDigestRow[]>([]);

// По умолчанию — сводная картина: все состояния всех очередей.
const selectedQueue = ref('all');
const selectedState = ref('all');
const jobs = ref<IQueueJobRow[]>([]);
const jobsTotal = ref(0);
const skip = ref(0);

/** Ключ задачи, чей ретрай в полёте, — кнопка блокируется только у неё. */
const retryBusyKey = ref('');
const retryError = ref('');

/** Ключ строки: id уникален только внутри своей очереди, а выдача сводная. */
function keyOf(job: IQueueJobRow): string {
  return `${job.queue}:${job.id}`;
}

const pageEnd = computed(() => Math.min(skip.value + jobs.value.length, jobsTotal.value));
const hasPrev = computed(() => skip.value > 0);
const hasNext = computed(() => pageEnd.value < jobsTotal.value);

let timer: number | undefined;

onMounted(load);
// Таймер снимается при уходе со страницы — иначе живой setInterval продолжал
// бы дёргать /api/queues с чужого экрана (правило LogsPage).
onBeforeUnmount(stopTimer);

async function load(): Promise<void> {
  if (!token.value) return;

  loading.value = true;
  loadError.value = '';

  try {
    const [summaries, digestRows, jobsPage] = await Promise.all([
      fetchQueues(token.value),
      fetchDigests(token.value),
      fetchQueueJobs(token.value, selectedQueue.value, {
        state: selectedState.value,
        limit: LIMIT,
        skip: skip.value,
      }),
    ]);
    queues.value = summaries;
    digests.value = digestRows;
    jobs.value = jobsPage.items;
    jobsTotal.value = jobsPage.total;
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

async function loadJobs(): Promise<void> {
  if (!token.value) return;

  loading.value = true;
  loadError.value = '';

  try {
    const page = await fetchQueueJobs(token.value, selectedQueue.value, {
      state: selectedState.value,
      limit: LIMIT,
      skip: skip.value,
    });
    jobs.value = page.items;
    jobsTotal.value = page.total;
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

/** Клик по счётчику в карточке очереди выбирает очередь и состояние сразу. */
async function select(queue: string, state: string): Promise<void> {
  selectedQueue.value = queue;
  selectedState.value = state;
  skip.value = 0;
  retryError.value = '';
  await loadJobs();
}

async function move(direction: -1 | 1): Promise<void> {
  skip.value = Math.max(0, skip.value + direction * LIMIT);
  await loadJobs();
}

async function retry(job: IQueueJobRow): Promise<void> {
  if (!token.value) return;

  retryBusyKey.value = keyOf(job);
  retryError.value = '';

  try {
    // Очередь — из самой строки: в сводной выдаче фильтр стоит на «all».
    await retryQueueJob(token.value, job.queue, job.id);
    // Состояние берём с сервера, а не переставляем строку сами: запрос мог
    // пройти, а задача — уже упасть снова (конвенция ToggleSwitch).
    await load();
  } catch (error) {
    retryError.value = describeError(error);
  } finally {
    retryBusyKey.value = '';
  }
}

function toggleAutoRefresh(): void {
  autoRefresh.value = !autoRefresh.value;
  if (!autoRefresh.value) return stopTimer();
  timer = window.setInterval(() => void load(), REFRESH_MS);
}

function stopTimer(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

/** Время по Москве — как в журнале: все разговоры про расписания ведутся в нём. */
const formatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatMs(ms: number | null | undefined): string {
  return ms ? formatter.format(new Date(ms)) : '—';
}

/** Кто: ник, если есть; иначе имя; иначе только id — как в журнале. */
function who(row: IDigestRow): string {
  if (row.username) return `@${row.username}`;
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ');
  return name || `id ${row.telegramUserId}`;
}

/** Payload одной строкой: полей мало — сервер отдаёт только белый список. */
function dataSummary(job: IQueueJobRow): string {
  return Object.entries(job.data)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
}
</script>

<template>
  <header>
    <h1>Очереди</h1>
    <div class="tools">
      <button type="button" :disabled="loading" @click="load">
        {{ loading ? 'Загрузка…' : 'Обновить' }}
      </button>
      <button type="button" :class="{ primary: autoRefresh }" @click="toggleAutoRefresh">
        Авто {{ autoRefresh ? 'вкл' : 'выкл' }}
      </button>
    </div>
  </header>

  <p v-if="loadError" class="error">{{ loadError }}</p>

  <div class="cards">
    <article v-for="queue in queues" :key="queue.name" class="card">
      <!-- Имя очереди — тоже фильтр: клик показывает все её задачи. -->
      <button
        type="button"
        class="card-title"
        :class="{ current: selectedQueue === queue.name && selectedState === 'all' }"
        @click="select(queue.name, 'all')"
      >
        {{ queue.name }}
      </button>
      <div class="counters">
        <button
          v-for="state in STATES"
          :key="state"
          type="button"
          class="counter"
          :class="{
            current: selectedQueue === queue.name && selectedState === state,
            danger: state === 'failed' && queue.counts.failed > 0,
          }"
          @click="select(queue.name, state)"
        >
          <span class="tnum value">{{ queue.counts[state as keyof typeof queue.counts] }}</span>
          <span class="label">{{ STATE_LABEL[state] }}</span>
        </button>
      </div>
    </article>
  </div>

  <section>
    <h2>Рассылки</h2>
    <div v-if="digests.length" class="scroll">
      <table>
        <thead>
          <tr>
            <th>Пользователь</th>
            <th>Магазин</th>
            <th>Отчёт</th>
            <th>Время</th>
            <th>Следующий запуск</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in digests" :key="`${row.botId}:${row.telegramUserId}:${row.reportKey}`">
            <td>
              <span class="name">{{ who(row) }}</span>
              <span class="muted">{{ row.telegramUserId }}</span>
            </td>
            <td>
              <template v-if="row.storeName">{{ row.storeName }}</template>
              <span v-else class="muted">не подключён</span>
            </td>
            <td>{{ row.reportTitle }}</td>
            <td class="nowrap">{{ row.time ? `${row.time} МСК` : row.cron }}</td>
            <td class="nowrap tnum">{{ formatMs(row.next) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="muted">Рассылки не настроены.</p>
  </section>

  <section>
    <h2>Задачи</h2>

    <div class="filters">
      <label>
        Очередь
        <select v-model="selectedQueue" @change="select(selectedQueue, selectedState)">
          <option value="all">все очереди</option>
          <option v-for="queue in queues" :key="queue.name" :value="queue.name">
            {{ queue.name }}
          </option>
        </select>
      </label>
      <div class="tabs">
        <button
          v-for="state in STATE_TABS"
          :key="state"
          type="button"
          :class="{ primary: selectedState === state }"
          @click="select(selectedQueue, state)"
        >
          {{ TAB_LABEL[state] }}
        </button>
      </div>
    </div>

    <!--
      Без этой оговорки пустой список читается как «все рассылки доставлены»,
      что неверно: у reports одна попытка, а ошибка гасится в обработчике и
      уходит в журнал, не оставляя здесь упавшей задачи.
    -->
    <p
      v-if="(selectedQueue === 'reports' || selectedQueue === 'all') && selectedState === 'failed'"
      class="muted"
    >
      Ошибки рассылок не остаются здесь упавшими задачами — обработчик гасит их и
      записывает в Журнал действий. Ищите их там по источнику «queue».
    </p>

    <p v-if="retryError" class="error">{{ retryError }}</p>

    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>Очередь</th>
            <th>Тип</th>
            <th>Состояние</th>
            <th>Данные</th>
            <th>Создана</th>
            <th>Завершена</th>
            <th>Попытки</th>
            <th>Причина падения</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="keyOf(job)">
            <td class="nowrap tnum">{{ job.id }}</td>
            <td class="nowrap">{{ job.queue }}</td>
            <td class="nowrap">{{ job.name }}</td>
            <td class="nowrap" :class="{ failed: job.state === 'failed' }">
              {{ STATE_ROW_LABEL[job.state] ?? job.state }}
            </td>
            <td>{{ dataSummary(job) || '—' }}</td>
            <td class="nowrap tnum">{{ formatMs(job.timestamp) }}</td>
            <td class="nowrap tnum">{{ formatMs(job.finishedOn) }}</td>
            <td class="tnum">{{ job.attemptsMade }}</td>
            <td class="reason" :title="job.failedReason">{{ job.failedReason || '—' }}</td>
            <td class="nowrap">
              <!-- Повторить можно только упавшую — кнопка живёт у строки, а не
                   у вкладки: в сводной выдаче состояния перемешаны. -->
              <button
                v-if="job.state === 'failed'"
                type="button"
                :disabled="retryBusyKey === keyOf(job)"
                @click="retry(job)"
              >
                {{ retryBusyKey === keyOf(job) ? 'Повтор…' : 'Повторить' }}
              </button>
            </td>
          </tr>
          <tr v-if="!jobs.length">
            <td colspan="10" class="empty">Задач нет</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer>
      <span class="muted">
        {{ jobsTotal ? `${skip + 1}–${pageEnd} из ${jobsTotal}` : 'Задач нет' }}
      </span>
      <span class="pager">
        <button type="button" :disabled="!hasPrev || loading" @click="move(-1)">Назад</button>
        <button type="button" :disabled="!hasNext || loading" @click="move(1)">Вперёд</button>
      </span>
    </footer>
  </section>
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

h2 {
  margin: 0 0 8px;
  font-size: 16px;
}

.tools,
.pager {
  display: flex;
  gap: 8px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}

/* Заголовок карточки — кнопка-фильтр, но выглядит заголовком, а не кнопкой. */
.card-title {
  display: block;
  padding: 0;
  margin-bottom: 10px;
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}

.card-title:hover,
.card-title.current {
  color: var(--accent);
}

.counters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/*
 * Счётчик — кнопка: клик выбирает очередь и состояние в блоке «Задачи».
 * Цвет работает один раз — на упавших задачах, которых больше нуля.
 */
.counter {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  padding: 6px 10px;
  background: none;
}

.counter.current {
  border-color: var(--accent);
}

.counter .value {
  font-size: 16px;
  font-weight: 600;
}

.counter .label {
  font-size: 11px;
  color: var(--muted);
}

.counter.danger .value {
  color: var(--danger);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th,
td {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

thead th {
  position: sticky;
  top: 0;
  background: var(--surface);
  font-weight: 600;
  font-size: 13px;
}

.name {
  display: block;
}

.muted {
  color: var(--muted);
  font-size: 13px;
}

td .muted {
  font-size: 12px;
}

.nowrap {
  white-space: nowrap;
}

/* Единственный цвет в таблице — на упавших: остальное держит структура. */
td.failed {
  color: var(--danger);
}

/* Причина падения бывает длинной: обрезаем, полный текст — в title. */
.reason {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  color: var(--muted);
  padding: 20px;
  text-align: center;
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
