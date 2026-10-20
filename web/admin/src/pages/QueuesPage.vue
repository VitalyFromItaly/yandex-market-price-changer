<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type {
  IDigestRow,
  IFinanceImportCard,
  IFinancePeriodRow,
  IHostingReminder,
  IQueueJobRow,
  IQueueSummary,
  IStockPushScheduleRow,
  IWeeklyDigestRow,
} from '../api';

import ConfirmModal from '../components/ConfirmModal.vue';

import {
  fetchDigests,
  fetchFinanceImport,
  fetchHostingReminder,
  fetchStockPushSchedule,
  fetchWeeklyDigest,
  fetchQueueJobs,
  fetchQueues,
  retryQueueJob,
  runHostingReminder,
  runStockPushSchedule,
  runWeeklyDigest,
} from '../api';
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

/**
 * Напоминание об оплате хостинга — единственная рассылка «всем сразу».
 *
 * Своя карточка, а не строка в таблице ниже: там колонки «кто» и «какой
 * отчёт», а здесь получателей много и отчёта нет. Из-за этого её и не было
 * видно: выдача рассылок отбрасывает задачи чужого формата.
 */
const reminder = ref<IHostingReminder | null>(null);
const reminderAsking = ref(false);
const reminderBusy = ref(false);
const reminderError = ref('');
const reminderDone = ref('');

/**
 * Ночная загрузка финжурнала (TASK-112): по строке на продавца с заведённой
 * задачей. Грузится ОТДЕЛЬНО от общего Promise.all (прецедент метрик): сбой
 * этой ручки не должен ломать страницу, которую открывают ради упавших задач.
 */
const finance = ref<IFinanceImportCard | null>(null);
const financeError = ref('');

const OUTCOME_LABEL: Record<IFinancePeriodRow['lastOutcome'], string> = {
  imported: 'загружена новая версия',
  unchanged: 'без изменений',
  empty: 'отчёта нет',
  failed: 'сбой',
};

/** Месяц периода — «09.2026»: периоды календарные. */
function monthOf(period: IFinancePeriodRow): string {
  const [year, month] = period.periodFrom.split('-');
  return `${month}.${year}`;
}

/** Почему период «с расхождениями» — словами, иначе статус не проверить. */
function discrepancyOf(period: IFinancePeriodRow): string {
  const parts: string[] = [];
  if (period.unknownCount) parts.push(`без статьи: ${period.unknownCount}`);
  if (period.changedCount) parts.push(`пересчитано: ${period.changedCount}`);
  if (period.removedCount) parts.push(`убрано: ${period.removedCount}`);
  if (period.discrepancyCount) parts.push(`находок сверки: ${period.discrepancyCount}`);
  return parts.join(', ');
}

async function loadFinance(): Promise<void> {
  if (!token.value) return;
  try {
    finance.value = await fetchFinanceImport(token.value);
    financeError.value = '';
  } catch (error) {
    financeError.value = describeError(error);
  }
}

/**
 * ИИ-сводка недели (TASK-168): по строке на продавца с заведённой задачей и
 * итог последнего запуска из журнала — «ушла ли сводка». Грузится отдельно,
 * как финансы: сбой ручки не ломает страницу.
 */
const weekly = ref<IWeeklyDigestRow[] | null>(null);
const weeklyError = ref('');
/** Кому отправить по кнопке: id строки или введённый (админ — себе). */
const weeklyAsking = ref('');
const weeklyTarget = ref('');
const weeklyBusy = ref(false);
const weeklyDone = ref('');

async function loadWeekly(): Promise<void> {
  if (!token.value) return;
  try {
    weekly.value = await fetchWeeklyDigest(token.value);
    weeklyError.value = '';
  } catch (error) {
    weeklyError.value = describeError(error);
  }
}

/** Сводка — платный запрос к ИИ и сообщение реальному продавцу: только через подтверждение. */
async function sendWeekly(): Promise<void> {
  if (!token.value || !weeklyAsking.value) return;
  weeklyBusy.value = true;
  weeklyDone.value = '';
  try {
    await runWeeklyDigest(token.value, weeklyAsking.value);
    weeklyDone.value = `Сводка для id ${weeklyAsking.value} поставлена в очередь — итог появится строкой «последний запуск».`;
    weeklyAsking.value = '';
    await loadWeekly();
  } catch (error) {
    weeklyError.value = describeError(error);
  } finally {
    weeklyBusy.value = false;
  }
}

/**
 * «Передача остатков» по расписанию (TASK-176): по строке на продавца с
 * заведённым проходом и итог последнего прохода из журнала. Грузится отдельно,
 * как финансы: сбой ручки не ломает страницу.
 */
const push = ref<IStockPushScheduleRow[] | null>(null);
const pushError = ref('');
const pushAsking = ref('');
const pushBusy = ref(false);
const pushDone = ref('');

async function loadPush(): Promise<void> {
  if (!token.value) return;
  try {
    push.value = await fetchStockPushSchedule(token.value);
    pushError.value = '';
  } catch (error) {
    pushError.value = describeError(error);
  }
}

/** Проход пишет остатки в кабинеты продавца: только через подтверждение. */
async function runPush(): Promise<void> {
  if (!token.value || !pushAsking.value) return;
  pushBusy.value = true;
  pushDone.value = '';
  try {
    await runStockPushSchedule(token.value, pushAsking.value);
    pushDone.value = `Проход для id ${pushAsking.value} поставлен в очередь — итог появится строкой «последний проход».`;
    pushAsking.value = '';
    await loadPush();
  } catch (error) {
    pushError.value = describeError(error);
  } finally {
    pushBusy.value = false;
  }
}

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
  void loadFinance();
  void loadWeekly();
  void loadPush();

  try {
    const [summaries, digestRows, reminderCard, jobsPage] = await Promise.all([
      fetchQueues(token.value),
      fetchDigests(token.value),
      fetchHostingReminder(token.value),
      fetchQueueJobs(token.value, selectedQueue.value, {
        state: selectedState.value,
        limit: LIMIT,
        skip: skip.value,
      }),
    ]);
    queues.value = summaries;
    digests.value = digestRows;
    reminder.value = reminderCard;
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

/**
 * Разослать напоминание прямо сейчас.
 *
 * Сообщение уходит РЕАЛЬНЫМ продавцам, поэтому только через подтверждение с
 * числом получателей: «отправить сейчас» — необратимое действие, в отличие от
 * ретрая упавшей задачи рядом.
 */
async function sendReminder(): Promise<void> {
  if (!token.value) return;

  reminderBusy.value = true;
  reminderError.value = '';
  reminderDone.value = '';

  try {
    const count = await runHostingReminder(token.value);
    reminderAsking.value = false;
    // Не «отправлено»: джоба поставлена в очередь, отправка идёт в фоне с
    // паузами между сообщениями. Итог появится строкой «последняя отправка».
    reminderDone.value = `Рассылка поставлена в очередь: получателей ${count}.`;
    await load();
  } catch (error) {
    reminderError.value = describeError(error);
  } finally {
    reminderBusy.value = false;
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

/** Момент из журнала приходит строкой ISO, а не миллисекундами. */
function formatDate(value: string | null | undefined): string {
  return value ? formatter.format(new Date(value)) : '—';
}

/**
 * Кто: ник, если есть; иначе имя; иначе только id — как в журнале.
 *
 * Тип структурный: одна и та же подпись нужна обеим таблицам экрана —
 * рассылкам и задачам, — а строки у них разные.
 */
function who(row: {
  username?: string;
  firstName?: string;
  lastName?: string;
  telegramUserId?: string;
}): string {
  if (row.username) return `@${row.username}`;
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ');
  return name || `id ${row.telegramUserId}`;
}

/**
 * Payload одной строкой: полей мало — сервер отдаёт только белый список.
 * Пользователь из сводки исключён — у него своя колонка.
 */
function dataSummary(job: IQueueJobRow): string {
  return Object.entries(job.data)
    .filter(([key]) => key !== 'telegramUserId' && key !== 'userId')
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

  <section v-if="reminder">
    <h2>💳 Напоминание об оплате хостинга</h2>

    <article class="card reminder">
      <!--
        Первая строка отвечает на главный вопрос — работает ли оно вообще.
        «Задача не заведена» означает, что развёрнут код без рассылки, и это
        совсем другой разговор, чем «сегодня не тот день».
      -->
      <p v-if="reminder.schedule" class="ok">
        Задача заведена. Следующая отправка:
        <b class="tnum">{{ formatMs(reminder.schedule.next) }}</b>
        <span class="muted">
          ({{ reminder.schedule.time ? `${reminder.schedule.time} МСК` : reminder.schedule.cron }},
          последний день месяца)
        </span>
      </p>
      <p v-else class="error">
        Задача не заведена — значит, развёрнута версия без рассылки. Напоминание не уйдёт.
      </p>

      <p>
        Последняя отправка:
        <template v-if="reminder.lastRun">
          <b class="tnum">{{ formatDate(reminder.lastRun.at) }}</b> — {{ reminder.lastRun.action }}
        </template>
        <span v-else class="muted">отправок не было</span>
      </p>

      <p>
        Получателей сейчас: <b class="tnum">{{ reminder.items.length }}</b>
      </p>

      <ul v-if="reminder.items.length" class="recipients">
        <li v-for="row in reminder.items" :key="`${row.botId}:${row.telegramUserId}`">
          <span class="name">{{ who(row) }}</span>
          <span class="muted">{{ row.storeName || 'магазин без названия' }}</span>
        </li>
      </ul>
      <!-- Ноль получателей объясняем словами: пустота читается как поломка. -->
      <p v-else class="muted">
        Никому: напоминание уходит одобренным продавцам с подключённым магазином, у которых открыта
        возможность «Напоминание об оплате».
      </p>

      <div class="tools">
        <button type="button" :disabled="reminderBusy" @click="reminderAsking = true">
          Отправить сейчас
        </button>
        <span v-if="reminderDone" class="muted">{{ reminderDone }}</span>
      </div>
      <p v-if="reminderError" class="error">{{ reminderError }}</p>
    </article>
  </section>

  <ConfirmModal
    v-if="reminderAsking"
    title="Отправить напоминание сейчас?"
    :message="`Сообщение об оплате хостинга уйдёт продавцам: ${reminder?.items.length ?? 0}. Отменить отправку будет нельзя.`"
    confirm-label="Отправить"
    busy-label="Отправка…"
    :busy="reminderBusy"
    @confirm="sendReminder"
    @cancel="reminderAsking = false"
  />

  <section>
    <h2>📒 Загрузка финансов</h2>

    <article class="card reminder">
      <p v-if="financeError" class="error">{{ financeError }}</p>
      <template v-else-if="finance">
        <p v-if="finance.periodsError" class="error">
          Статусы периодов недоступны (Postgres): {{ finance.periodsError }}
        </p>
        <p>
          Продавцов с ночной загрузкой: <b class="tnum">{{ finance.items.length }}</b>
        </p>
        <ul v-if="finance.items.length" class="recipients">
          <li v-for="row in finance.items" :key="row.telegramUserId">
            <span class="name">{{ who(row) }}</span>
            <span class="muted">{{ row.storeName || 'магазин без названия' }}</span>
            <div>
              Следующая загрузка: <b class="tnum">{{ formatMs(row.next) }}</b>
              <span class="muted">({{ row.time ? `${row.time} МСК` : row.tz }})</span>
            </div>
            <div>
              Последняя:
              <template v-if="row.last">
                <b class="tnum">{{ formatDate(row.last.at) }}</b> —
                {{ OUTCOME_LABEL[row.last.outcome] }}
              </template>
              <span v-else class="muted">загрузок ещё не было</span>
            </div>
            <ul v-if="row.periods.length" class="periods">
              <li v-for="period in row.periods" :key="period.periodFrom">
                <span class="tnum">{{ monthOf(period) }}</span>
                <b :class="`status-${period.status}`">{{ period.statusLabel }}</b>
                <span v-if="period.status === 'discrepancy'" class="muted">
                  ({{ discrepancyOf(period) }})
                </span>
                <!-- Закрытый месяц без «Проверено» из-за сверки — причина словами. -->
                <span v-if="period.reconcileNote" class="muted">
                  — сверка не сделана: {{ period.reconcileNote }}
                </span>
                <span v-if="period.error" class="error">— сбой: {{ period.error }}</span>
                <!-- Какой акт не сошёлся с отчётом услуг — сумма и разница словами. -->
                <div v-for="act in period.actMismatches ?? []" :key="act" class="error">
                  {{ act }}
                </div>
              </li>
            </ul>
          </li>
        </ul>
        <!-- Пустоту объясняем словами: иначе она читается как поломка. -->
        <p v-else class="muted">
          Никому: загрузка ставится одобренным продавцам с подключённым магазином и открытой
          возможностью «Финансы», а также администраторам с магазином.
        </p>
      </template>
    </article>
  </section>

  <section>
    <h2>🤖 ИИ-сводка недели</h2>

    <article class="card reminder">
      <p v-if="weeklyError" class="error">{{ weeklyError }}</p>
      <template v-if="weekly">
        <p>
          Продавцов со сводкой: <b class="tnum">{{ weekly.length }}</b>
          <span class="muted">(понедельник, 10:00 МСК, за прошлую неделю)</span>
        </p>
        <ul v-if="weekly.length" class="recipients">
          <li v-for="row in weekly" :key="row.telegramUserId">
            <span class="name">{{ who(row) }}</span>
            <span class="muted">{{ row.storeName || 'магазин без названия' }}</span>
            <div>
              Следующая: <b class="tnum">{{ formatMs(row.next) }}</b>
            </div>
            <div>
              Последний запуск:
              <template v-if="row.last">
                <b class="tnum">{{ formatDate(row.last.at) }}</b> — {{ row.last.action }}
              </template>
              <span v-else class="muted">ещё не было</span>
            </div>
            <button type="button" :disabled="weeklyBusy" @click="weeklyAsking = row.telegramUserId">
              Отправить сейчас
            </button>
          </li>
        </ul>
        <!-- Пустоту объясняем словами: иначе она читается как поломка. -->
        <p v-else class="muted">
          Никому: сводка ставится одобренным продавцам с подключённым магазином и открытыми
          возможностями «ИИ-сводка недели», «ИИ» и «Финансы». Администраторам — только кнопкой.
        </p>
        <div class="tools">
          <input v-model.trim="weeklyTarget" placeholder="Telegram id (себе)" inputmode="numeric" />
          <button
            type="button"
            :disabled="weeklyBusy || !/^\d+$/.test(weeklyTarget)"
            @click="weeklyAsking = weeklyTarget"
          >
            Отправить сейчас
          </button>
          <span v-if="weeklyDone" class="muted">{{ weeklyDone }}</span>
        </div>
      </template>
    </article>
  </section>

  <ConfirmModal
    v-if="weeklyAsking"
    title="Отправить ИИ-сводку сейчас?"
    :message="`Сводка за прошлую неделю уйдёт в Telegram (id ${weeklyAsking}) — это запрос к ИИ за счёт дневного лимита. Отменить отправку будет нельзя.`"
    confirm-label="Отправить"
    busy-label="Отправка…"
    :busy="weeklyBusy"
    @confirm="sendWeekly"
    @cancel="weeklyAsking = ''"
  />

  <section>
    <h2>🔁 Передача остатков по расписанию</h2>

    <article class="card reminder">
      <p v-if="pushError" class="error">{{ pushError }}</p>
      <template v-if="push">
        <p>
          Продавцов с расписанием: <b class="tnum">{{ push.length }}</b>
          <span class="muted">(каждые 30 минут, МСК)</span>
        </p>
        <ul v-if="push.length" class="recipients">
          <li v-for="row in push" :key="row.telegramUserId">
            <span class="name">{{ who(row) }}</span>
            <span class="muted">{{ row.storeName || 'магазин без названия' }}</span>
            <div>
              Следующий: <b class="tnum">{{ formatMs(row.next) }}</b>
            </div>
            <div :class="{ error: row.last?.status === 'error' }">
              Последний проход:
              <template v-if="row.last">
                <b class="tnum">{{ formatDate(row.last.at) }}</b> — {{ row.last.action }}
              </template>
              <span v-else class="muted">ещё не было</span>
            </div>
            <button type="button" :disabled="pushBusy" @click="pushAsking = row.telegramUserId">
              Запустить сейчас
            </button>
          </li>
        </ul>
        <!-- Пустоту объясняем словами: иначе она читается как поломка. -->
        <p v-else class="muted">
          Никому: проход ставится одобренным продавцам с открытыми возможностями «Передача остатков
          по расписанию» и хоть одной «Запись остатков в …». Открывать — только с согласия продавца.
        </p>
        <p v-if="pushDone" class="muted">{{ pushDone }}</p>
      </template>
    </article>
  </section>

  <ConfirmModal
    v-if="pushAsking"
    title="Запустить передачу остатков сейчас?"
    :message="`План остатков продавца (id ${pushAsking}) будет пересчитан и записан на площадки с открытой записью — это реальная запись в его кабинеты. Отменить её будет нельзя.`"
    confirm-label="Записать"
    busy-label="Постановка…"
    :busy="pushBusy"
    @confirm="runPush"
    @cancel="pushAsking = ''"
  />

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
      Ошибки рассылок не остаются здесь упавшими задачами — обработчик гасит их и записывает в
      Журнал действий. Ищите их там по источнику «queue».
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
            <th>Пользователь</th>
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
            <td>
              <template v-if="job.telegramUserId">
                <span class="name">{{ who(job) }}</span>
                <span class="muted">{{ job.telegramUserId }}</span>
              </template>
              <span v-else class="muted">—</span>
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
            <td colspan="11" class="empty">Задач нет</td>
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

/* Карточка рассылки — не счётчик, а текст: своя типографика, без сетки cards. */
.reminder p {
  margin: 0 0 8px;
}

/* Зелёным — только «задача заведена»: это ответ «оно работает», ради которого
   карточку и завели. Всё остальное держит структура, а не цвет. */
.reminder .ok {
  color: var(--ok);
}

.recipients {
  margin: 0 0 12px;
  padding: 0 0 0 18px;
}

.periods {
  margin: 4px 0 8px;
  padding: 0 0 0 18px;
}

.periods b {
  margin: 0 6px;
}

/* Цвет — только у статуса: это ответ «можно ли верить месяцу». */
.status-verified {
  color: var(--ok);
}

.status-discrepancy {
  color: var(--danger);
}

.status-preliminary {
  color: var(--warn);
}

.recipients .name {
  display: inline;
  margin-right: 6px;
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
