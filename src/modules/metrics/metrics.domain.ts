/**
 * Метрики бота: гистограммы задержек, разбор ответа Telegram и свёртки для
 * страницы «Метрики» админ-панели.
 *
 * Лист без единого импорта — как health.domain.ts и telegram-html.ts: здесь нет
 * ни Nest, ни mongoose, ни telegraf, поэтому всё проверяется юнит-тестом, а
 * время приходит параметром.
 *
 * Перцентили считаются здесь, в JS, а не `$percentile` в Mongo: тот появился
 * только в 7.0, а версия базы в проде не зафиксирована. Объём окна — тысячи
 * строк, и выборка с проекцией обходится дешевле второй точки отказа.
 */

/* ───────────────────────────── гистограмма ───────────────────────────── */

/**
 * Верхние границы корзин задержки, мс. Последняя корзина — «больше 30 с».
 *
 * Шаг неравномерный намеренно: нормальный ответ зеркала — сотни миллисекунд, и
 * различать 200 и 300 там важно, а между 10 и 30 секундами — уже нет: и то и
 * другое значит «зеркало умирает».
 */
export const LATENCY_BOUNDS_MS: readonly number[] = [
  50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 30000,
];

/** Длина гистограммы: по корзине на границу плюс переполнение. */
export const HISTOGRAM_SIZE = LATENCY_BOUNDS_MS.length + 1;

export function emptyHistogram(): number[] {
  return new Array<number>(HISTOGRAM_SIZE).fill(0);
}

/** Номер корзины для длительности. Граница включительно: 100 мс — корзина «≤100». */
export function latencyBucketIndex(ms: number): number {
  const index = LATENCY_BOUNDS_MS.findIndex((bound) => ms <= bound);
  return index === -1 ? LATENCY_BOUNDS_MS.length : index;
}

/**
 * Сложить гистограммы. Короткая или битая (из старой записи) дополняется
 * нулями, а не роняет свёртку: метрика не стоит упавшей страницы.
 */
export function addHistograms(into: number[], from: readonly number[] | undefined): number[] {
  if (!from) return into;
  for (let i = 0; i < HISTOGRAM_SIZE; i += 1) {
    const value = Number(from[i]);
    if (Number.isFinite(value)) into[i] += value;
  }
  return into;
}

/**
 * Перцентиль по гистограмме — ВЕРХНЯЯ граница корзины, в которую он попал.
 *
 * Значит «p95 ≤ 750 мс», а не точное число: честнее, чем интерполировать
 * внутри корзины и печатать точность, которой нет. Для корзины переполнения
 * границы нет — тогда отдаём наблюдённый максимум. Пустая гистограмма — null.
 */
export function histogramPercentile(
  histogram: readonly number[],
  q: number,
  maxMs: number,
): number | null {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;

  const rank = Math.ceil(q * total);
  let seen = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    seen += histogram[i];
    if (seen >= rank) {
      return i < LATENCY_BOUNDS_MS.length ? Math.min(LATENCY_BOUNDS_MS[i], maxMs) : maxMs;
    }
  }
  return maxMs;
}

/** Точный перцентиль по сырым значениям (nearest-rank). Пусто — null. */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1];
}

/* ───────────────────────────── ответ Telegram ───────────────────────────── */

/**
 * Исход вызова Bot API: `ok`, код ошибки Telegram строкой (`'403'`, `'429'`)
 * или `network` — ответа не было вовсе (таймаут, обрыв, DNS).
 *
 * `network` выделен отдельно потому, что это главный признак смерти зеркала
 * TELEGRAM_API_URL: Telegram отвечает 4xx/5xx, только когда до него дошли.
 */
export type TApiOutcome = string;
export const OUTCOME_OK = 'ok';
export const OUTCOME_NETWORK = 'network';

export interface ITelegramErrorInfo {
  /** error_code из ответа Telegram; нет — до Telegram не дошли. */
  code?: number;
  description?: string;
  /** parameters.retry_after при 429, секунды. */
  retryAfter?: number;
}

/**
 * Разобрать ошибку вызова Bot API.
 *
 * Утиная типизация, а не `instanceof TelegramError`: модуль — лист без
 * импортов, а у telegraf код и описание лежат в `response`.
 */
export function telegramErrorInfo(error: unknown): ITelegramErrorInfo {
  if (!error || typeof error !== 'object') return {};
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return {};

  const body = response as {
    error_code?: unknown;
    description?: unknown;
    parameters?: { retry_after?: unknown };
  };
  const code = typeof body.error_code === 'number' ? body.error_code : undefined;
  if (code === undefined) return {};

  const retryAfter = body.parameters?.retry_after;
  return {
    code,
    description: typeof body.description === 'string' ? body.description : undefined,
    retryAfter: typeof retryAfter === 'number' ? retryAfter : undefined,
  };
}

export function outcomeOf(error: unknown): TApiOutcome {
  if (error === undefined) return OUTCOME_OK;
  const { code } = telegramErrorInfo(error);
  return code === undefined ? OUTCOME_NETWORK : String(code);
}

/**
 * Будить ли админов из-за неудачной отправки.
 *
 * 400 и 403 — поведение клиента, не авария: 403 значит «пользователь
 * заблокировал бота», и алерт на каждого такого сделал бы алерты нечитаемыми
 * (тот же принцип «4xx не алертит», что у HTTP). Запись в журнале остаётся.
 * 429, 5xx и сетевые сбои — будят: это мы упёрлись в лимит или легло зеркало.
 */
export function shouldAlertTelegramError(info: ITelegramErrorInfo): boolean {
  if (info.code === undefined) return true;
  return info.code === 429 || info.code >= 500;
}

/* ──────────────────────────── время и окна ──────────────────────────── */

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;

export function floorTo(ms: number, step: number): number {
  return Math.floor(ms / step) * step;
}

export const METRICS_RANGES = { '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS } as const;
export type TMetricsRange = keyof typeof METRICS_RANGES;

export function isMetricsRange(value: unknown): value is TMetricsRange {
  return typeof value === 'string' && Object.hasOwn(METRICS_RANGES, value);
}

/** Шаг таймлайна: час для суток (24 столбца), шесть часов для недели (28). */
export function timelineStep(range: TMetricsRange): number {
  return range === '24h' ? HOUR_MS : 6 * HOUR_MS;
}

/** Начала столбцов таймлайна от `since` до `until` с шагом `step`. */
export function timelineSlots(since: number, until: number, step: number): number[] {
  const slots: number[] = [];
  for (let at = floorTo(since, step); at < until; at += step) slots.push(at);
  return slots;
}

/* ──────────────────────────── Telegram API ──────────────────────────── */

/**
 * Методы с долгим опросом: их длительность — таймаут, заданный нами, а не
 * скорость ответа. В счёт и ошибки входят, в задержку — нет, иначе один
 * getUpdates на 50 с превращает p95 всего API в «50 с».
 */
export const LONG_POLL_METHODS: readonly string[] = ['getUpdates'];

/** Минутный бакет вызовов одного метода с одним исходом. */
export interface IApiBucket {
  minute: Date | number;
  botId: string;
  method: string;
  outcome: TApiOutcome;
  count: number;
  sumMs: number;
  maxMs: number;
  lat: readonly number[];
}

export interface IApiMethodStats {
  method: string;
  count: number;
  errors: number;
  /** Ошибки по исходу: `{ '403': 2, network: 1 }`. */
  byOutcome: Record<string, number>;
  /** null у long-poll методов и у метода без единого вызова. */
  avgMs: number | null;
  p50: number | null;
  p95: number | null;
  maxMs: number | null;
}

export interface IApiTimelinePoint {
  at: number;
  calls: number;
  errors: number;
  network: number;
}

export interface IApiSummary {
  total: number;
  errors: number;
  network: number;
  /** По всем методам, кроме long-poll. */
  p50: number | null;
  p95: number | null;
  methods: IApiMethodStats[];
  timeline: IApiTimelinePoint[];
}

interface IMethodAcc {
  count: number;
  errors: number;
  byOutcome: Record<string, number>;
  sumMs: number;
  maxMs: number;
  lat: number[];
}

function timeOf(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

/**
 * Свернуть минутные бакеты в сводку окна: по методам и по столбцам таймлайна.
 * Методы — по убыванию числа вызовов, ошибки внутри — по убыванию тоже.
 */
export function summarizeApi(
  buckets: readonly IApiBucket[],
  slots: readonly number[],
  step: number,
): IApiSummary {
  const byMethod = new Map<string, IMethodAcc>();
  const overall = emptyHistogram();
  let overallMax = 0;
  let total = 0;
  let errors = 0;
  let network = 0;

  const timeline = new Map<number, IApiTimelinePoint>(
    slots.map((at) => [at, { at, calls: 0, errors: 0, network: 0 }]),
  );

  for (const bucket of buckets) {
    const count = Number(bucket.count) || 0;
    const failed = bucket.outcome !== OUTCOME_OK;
    const isNetwork = bucket.outcome === OUTCOME_NETWORK;

    total += count;
    if (failed) errors += count;
    if (isNetwork) network += count;

    const acc = byMethod.get(bucket.method) ?? {
      count: 0,
      errors: 0,
      byOutcome: {},
      sumMs: 0,
      maxMs: 0,
      lat: emptyHistogram(),
    };
    acc.count += count;
    if (failed) {
      acc.errors += count;
      acc.byOutcome[bucket.outcome] = (acc.byOutcome[bucket.outcome] ?? 0) + count;
    }
    acc.sumMs += Number(bucket.sumMs) || 0;
    acc.maxMs = Math.max(acc.maxMs, Number(bucket.maxMs) || 0);
    addHistograms(acc.lat, bucket.lat);
    byMethod.set(bucket.method, acc);

    if (!LONG_POLL_METHODS.includes(bucket.method)) {
      addHistograms(overall, bucket.lat);
      overallMax = Math.max(overallMax, Number(bucket.maxMs) || 0);
    }

    const point = timeline.get(floorTo(timeOf(bucket.minute), step));
    if (point) {
      point.calls += count;
      if (failed) point.errors += count;
      if (isNetwork) point.network += count;
    }
  }

  const methods = [...byMethod.entries()]
    .map(([method, acc]): IApiMethodStats => {
      const timed = !LONG_POLL_METHODS.includes(method) && acc.count > 0;
      return {
        method,
        count: acc.count,
        errors: acc.errors,
        byOutcome: acc.byOutcome,
        avgMs: timed ? Math.round(acc.sumMs / acc.count) : null,
        p50: timed ? histogramPercentile(acc.lat, 0.5, acc.maxMs) : null,
        p95: timed ? histogramPercentile(acc.lat, 0.95, acc.maxMs) : null,
        maxMs: timed ? acc.maxMs : null,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    total,
    errors,
    network,
    p50: histogramPercentile(overall, 0.5, overallMax),
    p95: histogramPercentile(overall, 0.95, overallMax),
    methods,
    timeline: [...timeline.values()],
  };
}

/* ──────────────────────────── health-образцы ──────────────────────────── */

export interface IHealthSampleRow {
  at: Date | number;
  key: string;
  state: string;
  latencyMs?: number | null;
}

export interface IProbeSummary {
  key: string;
  samples: number;
  down: number;
  p50: number | null;
  p95: number | null;
  maxMs: number | null;
  last: { at: number; state: string; latencyMs: number | null } | null;
  /** Средняя задержка по столбцам; null — образцов в столбце не было. */
  timeline: { at: number; avgMs: number | null; down: number }[];
}

/** Свёртка образцов самопроверки одного ключа. Ожидает их по возрастанию `at`. */
export function summarizeProbe(
  key: string,
  rows: readonly IHealthSampleRow[],
  slots: readonly number[],
  step: number,
): IProbeSummary {
  const own = rows.filter((row) => row.key === key);
  const latencies = own
    .map((row) => row.latencyMs)
    .filter((ms): ms is number => typeof ms === 'number');

  const acc = new Map<number, { sum: number; n: number; down: number }>(
    slots.map((at) => [at, { sum: 0, n: 0, down: 0 }]),
  );
  for (const row of own) {
    const slot = acc.get(floorTo(timeOf(row.at), step));
    if (!slot) continue;
    if (row.state === 'down') slot.down += 1;
    if (typeof row.latencyMs === 'number') {
      slot.sum += row.latencyMs;
      slot.n += 1;
    }
  }

  const lastRow = own.length > 0 ? own[own.length - 1] : undefined;

  return {
    key,
    samples: own.length,
    down: own.filter((row) => row.state === 'down').length,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    maxMs: latencies.length > 0 ? Math.max(...latencies) : null,
    last: lastRow
      ? {
          at: timeOf(lastRow.at),
          state: lastRow.state,
          latencyMs: typeof lastRow.latencyMs === 'number' ? lastRow.latencyMs : null,
        }
      : null,
    timeline: [...acc.entries()].map(([at, slot]) => ({
      at,
      avgMs: slot.n > 0 ? Math.round(slot.sum / slot.n) : null,
      down: slot.down,
    })),
  };
}

/* ──────────────────────────── работа бота ──────────────────────────── */

/** Входящий апдейт из журнала — только поля, нужные свёртке. */
export interface IUpdateRow {
  createdAt: Date | number;
  telegramUserId: string;
  username?: string;
  kind: string;
  action?: string;
  status: string;
  durationMs?: number | null;
  refusedBy?: string | null;
}

export interface IKindStats {
  kind: string;
  count: number;
  errors: number;
  p50: number | null;
  p95: number | null;
}

export interface IBotSummary {
  updates: number;
  errors: number;
  users: number;
  p50: number | null;
  p95: number | null;
  /** Отказы гейтов: `{ access: 3, feature: 1 }`. */
  refused: Record<string, number>;
  kinds: IKindStats[];
  slowest: {
    at: number;
    telegramUserId: string;
    username?: string;
    kind: string;
    action?: string;
    durationMs: number;
  }[];
  timeline: { at: number; updates: number; errors: number }[];
}

/** Сколько самых медленных действий показывать. */
export const SLOWEST_LIMIT = 5;

export function summarizeUpdates(
  rows: readonly IUpdateRow[],
  slots: readonly number[],
  step: number,
): IBotSummary {
  const durationsOf = (list: readonly IUpdateRow[]): number[] =>
    list.map((row) => row.durationMs).filter((ms): ms is number => typeof ms === 'number');

  const byKind = new Map<string, IUpdateRow[]>();
  const refused: Record<string, number> = {};
  const timeline = new Map<number, { at: number; updates: number; errors: number }>(
    slots.map((at) => [at, { at, updates: 0, errors: 0 }]),
  );

  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row);
    byKind.set(row.kind, list);

    if (row.refusedBy) refused[row.refusedBy] = (refused[row.refusedBy] ?? 0) + 1;

    const point = timeline.get(floorTo(timeOf(row.createdAt), step));
    if (point) {
      point.updates += 1;
      if (row.status === 'error') point.errors += 1;
    }
  }

  const all = durationsOf(rows);

  return {
    updates: rows.length,
    errors: rows.filter((row) => row.status === 'error').length,
    users: new Set(rows.map((row) => row.telegramUserId)).size,
    p50: percentile(all, 0.5),
    p95: percentile(all, 0.95),
    refused,
    kinds: [...byKind.entries()]
      .map(([kind, list]): IKindStats => {
        const durations = durationsOf(list);
        return {
          kind,
          count: list.length,
          errors: list.filter((row) => row.status === 'error').length,
          p50: percentile(durations, 0.5),
          p95: percentile(durations, 0.95),
        };
      })
      .sort((a, b) => b.count - a.count),
    slowest: rows
      .filter((row) => typeof row.durationMs === 'number')
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, SLOWEST_LIMIT)
      .map((row) => ({
        at: timeOf(row.createdAt),
        telegramUserId: row.telegramUserId,
        username: row.username,
        kind: row.kind,
        action: row.action,
        durationMs: row.durationMs ?? 0,
      })),
    timeline: [...timeline.values()],
  };
}
