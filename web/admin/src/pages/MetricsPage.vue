<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { IMetricsReport, TMetricsRange } from '../api';
import type { IBar } from '../components/SparkBars.vue';

import { fetchMetrics } from '../api';
import { describeError, token } from '../auth';
import SparkBars from '../components/SparkBars.vue';
import {
  formatCount,
  formatMs,
  formatShare,
  formatStamp,
  kindLabel,
  outcomeLabel,
  probeLabel,
  refusedLabel,
} from '../metrics.domain';

const RANGES: { key: TMetricsRange; label: string }[] = [
  { key: '24h', label: 'Сутки' },
  { key: '7d', label: 'Неделя' },
];

const range = ref<TMetricsRange>('24h');
const report = ref<IMetricsReport | null>(null);
const loading = ref(false);
const loadError = ref('');

onMounted(load);

async function load(): Promise<void> {
  if (!token.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    report.value = await fetchMetrics(token.value, range.value);
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

function pick(next: TMetricsRange): void {
  if (range.value === next) return;
  range.value = next;
  void load();
}

const apiBars = computed<IBar[]>(() =>
  (report.value?.telegram.timeline ?? []).map((point) => ({
    at: point.at,
    value: point.calls,
    bad: point.errors,
    title:
      `${formatStamp(point.at)} · вызовов ${point.calls}, ошибок ${point.errors}` +
      (point.network ? ` (без ответа ${point.network})` : ''),
  })),
);

const updateBars = computed<IBar[]>(() =>
  (report.value?.bot.timeline ?? []).map((point) => ({
    at: point.at,
    value: point.updates,
    bad: point.errors,
    title: `${formatStamp(point.at)} · апдейтов ${point.updates}, ошибок ${point.errors}`,
  })),
);

function probeBars(key: string): IBar[] {
  const probe = report.value?.probes.find((p) => p.key === key);
  return (probe?.timeline ?? []).map((point) => ({
    at: point.at,
    value: point.avgMs,
    bad: point.down ? (point.avgMs ?? 0) : 0,
    title:
      `${formatStamp(point.at)} · ` +
      (point.avgMs === null ? 'нет замеров' : `в среднем ${formatMs(point.avgMs)}`) +
      (point.down ? `, аварий ${point.down}` : ''),
  }));
}

/** Ошибки метода одной строкой: «403 · бот заблокирован: 3; нет ответа: 1». */
function outcomes(byOutcome: Record<string, number>): string {
  return Object.entries(byOutcome)
    .sort((a, b) => b[1] - a[1])
    .map(([outcome, n]) => `${outcomeLabel(outcome)}: ${n}`)
    .join('; ');
}

const refusedTotal = computed(() =>
  Object.values(report.value?.bot.refused ?? {}).reduce((sum, n) => sum + n, 0),
);
</script>

<template>
  <header>
    <h1>Метрики</h1>
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
      <button type="button" :disabled="loading" @click="load">
        {{ loading ? 'Загрузка…' : 'Обновить' }}
      </button>
    </div>
  </header>

  <p v-if="loadError" class="error">{{ loadError }}</p>
  <p v-if="loading && !report" class="muted">Загрузка…</p>

  <template v-if="report">
    <!-- ───────────── Telegram API ───────────── -->
    <section>
      <h2>Ответы Telegram API</h2>
      <div class="totals">
        <div>
          <span class="n tnum">{{ formatCount(report.telegram.total) }}</span>
          <span class="muted">вызовов</span>
        </div>
        <div>
          <span class="n tnum" :class="{ bad: report.telegram.errors }">
            {{ formatCount(report.telegram.errors) }}
          </span>
          <span class="muted">
            ошибок · {{ formatShare(report.telegram.errors, report.telegram.total) }}
          </span>
        </div>
        <div>
          <span class="n tnum" :class="{ bad: report.telegram.network }">
            {{ formatCount(report.telegram.network) }}
          </span>
          <span class="muted">без ответа</span>
        </div>
        <div>
          <span class="n tnum">{{ formatMs(report.telegram.p50) }}</span>
          <span class="muted">медиана</span>
        </div>
        <div>
          <span class="n tnum">{{ formatMs(report.telegram.p95) }}</span>
          <span class="muted">p95</span>
        </div>
      </div>

      <SparkBars :bars="apiBars" />
      <p class="muted note">
        Столбец — вызовы за {{ report.range === '24h' ? 'час' : '6 часов' }}, красным — ошибки.
        Задержка — без getUpdates: это долгий опрос, его длительность задаём мы сами.
      </p>

      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Метод</th>
              <th class="num">Вызовов</th>
              <th class="num">Ошибок</th>
              <th class="num">Среднее</th>
              <th class="num">p50</th>
              <th class="num">p95</th>
              <th class="num">Макс.</th>
              <th>Чем ответил</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in report.telegram.methods" :key="row.method">
              <td>
                <code>{{ row.method }}</code>
              </td>
              <td class="num tnum">{{ formatCount(row.count) }}</td>
              <td class="num tnum" :class="{ bad: row.errors }">{{ formatCount(row.errors) }}</td>
              <td class="num tnum">{{ formatMs(row.avgMs) }}</td>
              <td class="num tnum">{{ formatMs(row.p50) }}</td>
              <td class="num tnum">{{ formatMs(row.p95) }}</td>
              <td class="num tnum">{{ formatMs(row.maxMs) }}</td>
              <td class="muted">{{ outcomes(row.byOutcome) || '—' }}</td>
            </tr>
            <tr v-if="!report.telegram.methods.length">
              <td colspan="8" class="empty">
                Вызовов за период нет. Метрики пишутся раз в минуту — после деплоя данные появятся
                не сразу.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="report.telegram.recentErrors.length">
        <h3>Последние неудачные отправки</h3>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Кому</th>
                <th>Метод</th>
                <th>Код</th>
                <th>Ответ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in report.telegram.recentErrors" :key="index">
                <td class="nowrap tnum">{{ formatStamp(row.at) }}</td>
                <td class="tnum">{{ row.telegramUserId }}</td>
                <td>
                  <code>{{ row.method }}</code>
                </td>
                <td class="tnum">{{ row.code ?? '—' }}</td>
                <td class="reason" :title="row.error">{{ row.error }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <!-- ───────────── Задержка до зеркала ───────────── -->
    <section>
      <h2>Задержка внешних сервисов</h2>
      <p class="muted note">
        Самопроверка раз в 5 минут. getMe идёт тем же путём, что и ответы продавцам, — через зеркало
        TELEGRAM_API_URL, поэтому его рост — первый признак, что зеркало деградирует.
      </p>
      <div class="probes">
        <div v-for="probe in report.probes" :key="probe.key" class="probe">
          <div class="probe-head">
            <span class="label">{{ probeLabel(probe.key) }}</span>
            <span v-if="probe.last" class="muted tnum">
              сейчас
              <span :class="{ bad: probe.last.state === 'down' }">
                {{ probe.last.state === 'down' ? 'недоступно' : formatMs(probe.last.latencyMs) }}
              </span>
            </span>
          </div>
          <SparkBars :bars="probeBars(probe.key)" :height="36" />
          <div class="muted tnum probe-stats">
            <template v-if="probe.samples">
              p50 {{ formatMs(probe.p50) }} · p95 {{ formatMs(probe.p95) }} · макс.
              {{ formatMs(probe.maxMs) }} ·
              <span :class="{ bad: probe.down }">
                аварий {{ probe.down }} из {{ probe.samples }}
              </span>
            </template>
            <template v-else>замеров за период нет</template>
          </div>
        </div>
      </div>
    </section>

    <!-- ───────────── Работа бота ───────────── -->
    <section>
      <h2>Работа бота</h2>
      <div class="totals">
        <div>
          <span class="n tnum">{{ formatCount(report.bot.updates) }}</span>
          <span class="muted">апдейтов</span>
        </div>
        <div>
          <span class="n tnum">{{ formatCount(report.bot.users) }}</span>
          <span class="muted">пользователей</span>
        </div>
        <div>
          <span class="n tnum" :class="{ bad: report.bot.errors }">
            {{ formatCount(report.bot.errors) }}
          </span>
          <span class="muted">упали с ошибкой</span>
        </div>
        <div>
          <span class="n tnum">{{ formatCount(refusedTotal) }}</span>
          <span class="muted">
            отказов гейтов<template v-if="refusedTotal"
              >:
              <template v-for="(n, key, index) in report.bot.refused" :key="key">
                {{ index ? ',' : '' }} {{ refusedLabel(String(key)) }} {{ n }}
              </template>
            </template>
          </span>
        </div>
        <div>
          <span class="n tnum">{{ formatMs(report.bot.p50) }}</span>
          <span class="muted">медиана ответа</span>
        </div>
        <div>
          <span class="n tnum">{{ formatMs(report.bot.p95) }}</span>
          <span class="muted">p95</span>
        </div>
      </div>

      <SparkBars :bars="updateBars" />

      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Что прислали</th>
              <th class="num">Апдейтов</th>
              <th class="num">Ошибок</th>
              <th class="num">p50</th>
              <th class="num">p95</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in report.bot.kinds" :key="row.kind">
              <td>{{ kindLabel(row.kind) }}</td>
              <td class="num tnum">{{ formatCount(row.count) }}</td>
              <td class="num tnum" :class="{ bad: row.errors }">{{ formatCount(row.errors) }}</td>
              <td class="num tnum">{{ formatMs(row.p50) }}</td>
              <td class="num tnum">{{ formatMs(row.p95) }}</td>
            </tr>
            <tr v-if="!report.bot.kinds.length">
              <td colspan="5" class="empty">Апдейтов за период нет.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="report.bot.slowest.length">
        <h3>Самые медленные ответы</h3>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Кто</th>
                <th>Действие</th>
                <th class="num">Длилось</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in report.bot.slowest" :key="index">
                <td class="nowrap tnum">{{ formatStamp(row.at) }}</td>
                <td>
                  <span v-if="row.username">@{{ row.username }}</span>
                  <span class="muted tnum">{{ row.telegramUserId }}</span>
                </td>
                <td class="reason" :title="row.action">
                  <span class="muted">{{ kindLabel(row.kind) }}:</span> {{ row.action }}
                </td>
                <td class="num tnum">{{ formatMs(row.durationMs) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
  </template>
</template>

<style scoped>
header {
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

h3 {
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 600;
}

section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.controls,
.tabs {
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
}

.n {
  font-size: 20px;
  font-weight: 600;
}

/* Цвет — только у того, что сломалось: остальное держит структура. */
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

.probes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.probe {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.probe-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.label {
  font-size: 14px;
  font-weight: 500;
}

.probe-stats {
  font-size: 12px;
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

.reason {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  color: var(--muted);
  padding: 16px;
  text-align: center;
}

code {
  font-size: 13px;
}
</style>
