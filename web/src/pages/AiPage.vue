<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import type {
  IAiRequestRow,
  IAiRequestsQuery,
  IAiUsageReport,
  IUserRow,
  TAiUsageRange,
} from '../api';
import type { IBar } from '../components/SparkBars.vue';

import { fetchAiRequests, fetchAiUsage, fetchUsers } from '../api';
import { describeError, token } from '../auth';
import SparkBars from '../components/SparkBars.vue';
import { formatCount, formatMs, formatStamp } from '../metrics.domain';
import { logUserOptions } from '../users.domain';

/**
 * Расходы на ИИ. Ключ Polza один, платит владелец — страница отвечает «кто и
 * на что тратит». Суммы приходят посчитанными в Mongo; страница их только
 * показывает, иначе Σ на экране зависела бы от того, сколько строк влезло.
 * Текста промпта и ответа здесь нет и быть не может — он не хранится.
 */

const RANGES: { key: TAiUsageRange; label: string }[] = [
  { key: '24h', label: 'Сутки' },
  { key: '7d', label: 'Неделя' },
  { key: '30d', label: '30 дней' },
];
const PAGE = 50;

const range = ref<TAiUsageRange>('7d');
const report = ref<IAiUsageReport | null>(null);
const loading = ref(false);
const loadError = ref('');

const rows = ref<IAiRequestRow[]>([]);
const total = ref(0);
const skip = ref(0);
const rowsLoading = ref(false);
const rowsError = ref('');
const users = ref<IUserRow[]>([]);
const filters = reactive<IAiRequestsQuery>({ telegramUserId: '', status: '', purpose: '' });

/** Рубли с копейками: запрос стоит доли копейки, и «0 ₽» скрыл бы весь расход. */
const RUB = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
function rub(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${RUB.format(value)} ₽`;
}

function share(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')} %`;
}

function who(row: { telegramUserId: string; username?: string; name?: string }): string {
  if (row.username) return `@${row.username}`;
  return row.name ?? '';
}

const userOptions = computed(() =>
  logUserOptions(
    users.value,
    [...(report.value?.users ?? []), ...rows.value],
    filters.telegramUserId ?? '',
  ),
);

const dayBars = computed<IBar[]>(() =>
  (report.value?.days ?? []).map((day) => ({
    at: Date.parse(day.day),
    value: day.costRub,
    title: `${day.day} · ${rub(day.costRub)} · запросов ${day.requests}, ошибок ${day.errors}`,
  })),
);

const pageEnd = computed(() => Math.min(skip.value + rows.value.length, total.value));

onMounted(() => {
  // Журнал ждёт сводку: окно (since) берётся из её ответа.
  void refresh();
  void loadUsers();
});

async function load(): Promise<void> {
  if (!token.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    report.value = await fetchAiUsage(token.value, range.value);
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

/**
 * Журнал — за то же окно, что сводка, иначе Σ строк и Σ наверху отвечали бы на
 * разные вопросы.
 */
async function loadRows(): Promise<void> {
  if (!token.value) return;
  rowsLoading.value = true;
  rowsError.value = '';
  try {
    // until тоже из сводки: запрос, пришедший после неё, иначе попал бы в
    // журнал, но не в Σ наверху — «4 строки при 3 запросах».
    const since = report.value ? new Date(report.value.since).toISOString() : undefined;
    const until = report.value ? new Date(report.value.until).toISOString() : undefined;
    const page = await fetchAiRequests(token.value, {
      ...filters,
      since,
      until,
      limit: PAGE,
      skip: skip.value,
    });
    rows.value = page.items;
    total.value = page.total;
  } catch (error) {
    rowsError.value = describeError(error);
  } finally {
    rowsLoading.value = false;
  }
}

/** Подписи фильтра; без них журнал всё равно открывается. */
async function loadUsers(): Promise<void> {
  if (!token.value) return;
  try {
    users.value = await fetchUsers(token.value);
  } catch {
    users.value = [];
  }
}

async function refresh(): Promise<void> {
  await load();
  skip.value = 0;
  await loadRows();
}

function pick(next: TAiUsageRange): void {
  if (range.value === next) return;
  range.value = next;
  void refresh();
}

function apply(): void {
  skip.value = 0;
  void loadRows();
}

function move(direction: -1 | 1): void {
  skip.value = Math.max(0, skip.value + direction * PAGE);
  void loadRows();
}

function filterBy(telegramUserId: string): void {
  filters.telegramUserId = telegramUserId;
  apply();
}
</script>

<template>
  <header>
    <h1>ИИ</h1>
    <div class="controls">
      <div class="tabs">
        <button
          v-for="item in RANGES"
          :key="item.key"
          type="button"
          :class="{ primary: range === item.key }"
          :disabled="loading"
          @click="pick(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
      <button type="button" :disabled="loading" @click="refresh">
        {{ loading ? 'Загрузка…' : 'Обновить' }}
      </button>
    </div>
  </header>

  <p v-if="loadError" class="error">{{ loadError }}</p>
  <p v-if="loading && !report" class="muted">Загрузка…</p>

  <template v-if="report">
    <section>
      <div class="totals">
        <div>
          <span class="n tnum">{{ rub(report.balance?.available) }}</span>
          <span class="muted" :title="report.balanceError ?? ''">
            баланс Polza{{ report.balanceError ? ` — ${report.balanceError}` : '' }}
          </span>
        </div>
        <div>
          <span class="n tnum">{{ rub(report.totals.costRub) }}</span>
          <span class="muted">потрачено за период</span>
        </div>
        <div>
          <span class="n tnum">{{ formatCount(report.totals.requests) }}</span>
          <span class="muted">запросов</span>
        </div>
        <div>
          <span class="n tnum" :class="{ bad: report.totals.errors }">
            {{ formatCount(report.totals.errors) }}
          </span>
          <span class="muted">ошибок · {{ share(report.errorShare) }}</span>
        </div>
        <div>
          <span class="n tnum">
            {{ formatCount(report.totals.promptTokens) }} /
            {{ formatCount(report.totals.completionTokens) }}
          </span>
          <span class="muted">токенов вход / выход</span>
        </div>
      </div>
    </section>

    <section>
      <h2>Расход по дням</h2>
      <SparkBars :bars="dayBars" :height="64" />
      <p class="muted note">
        Столбец — рубли за московские сутки. Упавшие запросы Polza не тарифицирует.
      </p>
    </section>

    <div class="split">
      <section>
        <h2>По продавцам</h2>
        <p v-if="!report.users.length" class="muted note">Запросов за период не было.</p>
        <div v-else class="scroll">
          <table>
            <thead>
              <tr>
                <th>Продавец</th>
                <th class="num">₽</th>
                <th class="num">Запросов</th>
                <th class="num">Ошибок</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.users" :key="row.telegramUserId">
                <td>
                  <a href="#" @click.prevent="filterBy(row.telegramUserId)">
                    {{ who(row) || row.telegramUserId }}
                  </a>
                  <span v-if="who(row)" class="muted tnum">{{ row.telegramUserId }}</span>
                </td>
                <td class="num tnum">{{ rub(row.costRub) }}</td>
                <td class="num tnum">{{ formatCount(row.requests) }}</td>
                <td class="num tnum" :class="{ bad: row.errors }">{{ formatCount(row.errors) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>По назначению</h2>
        <p v-if="!report.purposes.length" class="muted note">Запросов за период не было.</p>
        <div v-else class="scroll">
          <table>
            <thead>
              <tr>
                <th>Purpose</th>
                <th class="num">₽</th>
                <th class="num">Запросов</th>
                <th class="num">Ошибок</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.purposes" :key="row.purpose">
                <td>
                  <code>{{ row.purpose }}</code>
                </td>
                <td class="num tnum">{{ rub(row.costRub) }}</td>
                <td class="num tnum">{{ formatCount(row.requests) }}</td>
                <td class="num tnum" :class="{ bad: row.errors }">{{ formatCount(row.errors) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </template>

  <section>
    <h2>Запросы</h2>
    <form class="filters" @submit.prevent="apply">
      <select v-model="filters.telegramUserId">
        <option value="">Все продавцы</option>
        <option v-for="option in userOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <select v-model="filters.status">
        <option value="">Любой статус</option>
        <option value="ok">Успешные</option>
        <option value="error">Ошибки</option>
      </select>
      <input v-model.trim="filters.purpose" placeholder="purpose" />
      <button type="submit" :disabled="rowsLoading">Применить</button>
    </form>

    <p v-if="rowsError" class="error">{{ rowsError }}</p>

    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Время, МСК</th>
            <th>Продавец</th>
            <th>Purpose</th>
            <th>Модель</th>
            <th class="num">Токены вх / вых / кэш</th>
            <th class="num">₽</th>
            <th class="num">Длительность</th>
            <th>Статус</th>
            <th>trace_id</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length">
            <td colspan="9" class="muted">{{ rowsLoading ? 'Загрузка…' : 'Запросов нет' }}</td>
          </tr>
          <tr v-for="row in rows" :key="`${row.createdAt}:${row.traceId}`">
            <td class="nowrap tnum">{{ formatStamp(Date.parse(row.createdAt)) }}</td>
            <td>
              {{ who(row) || row.telegramUserId }}
              <span v-if="who(row)" class="muted tnum">{{ row.telegramUserId }}</span>
            </td>
            <td>
              <code>{{ row.purpose }}</code>
            </td>
            <td :title="row.provider">{{ row.responseModel || row.model }}</td>
            <td class="num tnum">
              {{ formatCount(row.promptTokens) }} / {{ formatCount(row.completionTokens) }} /
              {{ formatCount(row.cachedTokens) }}
            </td>
            <td class="num tnum">{{ rub(row.costRub) }}</td>
            <td class="num tnum">{{ formatMs(row.durationMs) }}</td>
            <td :class="{ bad: row.status === 'error' }">
              {{ row.status === 'ok' ? 'ok' : 'ошибка' }}
              <span v-if="row.httpStatus || row.errorCode" class="muted tnum">
                {{ [row.httpStatus, row.errorCode].filter(Boolean).join(' · ') }}
              </span>
            </td>
            <td>
              <code class="trace">{{ row.traceId || '—' }}</code>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer>
      <span class="muted tnum">
        {{ total ? `${skip + 1}–${pageEnd} из ${total}` : 'Записей нет' }}
      </span>
      <span class="pager">
        <button type="button" :disabled="skip === 0 || rowsLoading" @click="move(-1)">Назад</button>
        <button type="button" :disabled="pageEnd >= total || rowsLoading" @click="move(1)">
          Вперёд
        </button>
      </span>
    </footer>
  </section>
</template>

<style scoped>
header,
footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.01em;
}

h2 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.controls,
.tabs,
.pager,
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.controls {
  gap: 12px;
}

.totals {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
}

.totals div {
  display: flex;
  flex-direction: column;
  max-width: 320px;
}

.n {
  font-size: 20px;
  font-weight: 600;
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 24px;
}

.bad {
  color: var(--danger);
}

.muted {
  color: var(--muted);
  font-size: 13px;
}

.note {
  margin: 0;
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
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

thead th {
  background: var(--surface);
  font-weight: 600;
  font-size: 13px;
}

.num {
  text-align: right;
  white-space: nowrap;
}

td .muted {
  font-size: 12px;
  margin-left: 4px;
}

.nowrap {
  white-space: nowrap;
}

/* trace_id — для обращения в поддержку Polza: выделяется целиком одним кликом. */
.trace {
  font-size: 12px;
  user-select: all;
  word-break: break-all;
}
</style>
