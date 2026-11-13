/**
 * Замер памяти процесса по фоновым задачам (OOM на проде 08.11, 10.11, 13.11.2026:
 * `node` рос до 3,3 ГБ из 4 ГБ, ядро его убивало, Swarm пересоздавал все контейнеры
 * и Postgres ~20 с не резолвился).
 *
 * Здесь — реестр идущих задач и правила, без Nest и без таймеров: сэмплер и алерт
 * живут в `MemoryWatchService`, а задачи оборачиваются `traceMemory`. Реестр —
 * модульный, а не провайдер: процессорам не нужен лишний DI ради одной строки лога.
 *
 * Логов убитого контейнера Swarm не хранит, поэтому главный сигнал — алерт админам
 * при пересечении порога со списком задач, идущих в этот момент.
 */

const MB = 1024 * 1024;

/** Как часто сэмплер читает RSS. Чаще — дорого без пользы, реже — пропустит пик. */
export const MEMORY_SAMPLE_INTERVAL_MS = 1000;

/** Порог алерта: норма бота ~170 МБ, сервер — 4 ГБ на всё вместе с базами. */
export const MEMORY_ALERT_RSS_BYTES = 1536 * MB;

/** Повторный алерт — только после спада ниже этого (гистерезис, без дребезга у порога). */
export const MEMORY_REARM_RSS_BYTES = 1024 * MB;

export interface IMemorySnapshot {
  rss: number;
  /** Занятая V8 куча; при бурном мусоре RSS растёт за счёт неё, а heapUsed после GC мал. */
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface IActiveMemoryJob {
  label: string;
  startedAt: number;
  startRss: number;
  peakRss: number;
  peakHeapTotal: number;
}

interface ILogger {
  log(message: string): void;
}

const active = new Map<number, IActiveMemoryJob>();
let sequence = 0;

export function snapshotMemory(): IMemorySnapshot {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

export function toMb(bytes: number): number {
  return Math.round(bytes / MB);
}

/** Поднять пик у всех идущих задач. Зовёт сэмплер; синхронно и не бросает. */
export function sampleActiveJobs(memory: Pick<IMemorySnapshot, 'rss' | 'heapTotal'>): void {
  for (const job of active.values()) {
    if (memory.rss > job.peakRss) job.peakRss = memory.rss;
    if (memory.heapTotal > job.peakHeapTotal) job.peakHeapTotal = memory.heapTotal;
  }
}

/** Идущие задачи, самые старые первыми. */
export function activeMemoryJobs(): IActiveMemoryJob[] {
  return [...active.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Обернуть задачу: на входе — в реестр, на выходе — строка лога с пиком RSS за время
 * задачи. RSS общий на процесс, поэтому пик делят все задачи, шедшие одновременно, —
 * виновника выделяет сравнение строк (у неё пик выше, чем у соседей без неё).
 */
export async function traceMemory<T>(
  label: string,
  run: () => Promise<T>,
  logger: ILogger,
  now: () => number = Date.now,
): Promise<T> {
  const id = ++sequence;
  const start = snapshotMemory();
  const job: IActiveMemoryJob = {
    label,
    startedAt: now(),
    startRss: start.rss,
    peakRss: start.rss,
    peakHeapTotal: start.heapTotal,
  };
  active.set(id, job);
  try {
    return await run();
  } finally {
    active.delete(id);
    const end = snapshotMemory();
    if (end.rss > job.peakRss) job.peakRss = end.rss;
    if (end.heapTotal > job.peakHeapTotal) job.peakHeapTotal = end.heapTotal;
    logger.log(memoryTraceLine(job, end, now(), active.size));
  }
}

export function memoryTraceLine(
  job: IActiveMemoryJob,
  end: IMemorySnapshot,
  now: number,
  othersActive: number,
): string {
  const seconds = Math.round((now - job.startedAt) / 100) / 10;
  return (
    `Память ${job.label}: rss ${toMb(job.startRss)}→${toMb(end.rss)} МБ, пик ${toMb(job.peakRss)} МБ, ` +
    `heapTotal пик ${toMb(job.peakHeapTotal)} МБ, heap ${toMb(end.heapUsed)} МБ, buffers ${toMb(end.arrayBuffers)} МБ, ${seconds} с, ` +
    `рядом задач ${othersActive}`
  );
}

/**
 * Решение сэмплера: `alert` — только при пересечении порога снизу вверх; дальше
 * молчим, пока RSS не упадёт ниже `MEMORY_REARM_RSS_BYTES`.
 */
export function nextMemoryAlertState(
  armed: boolean,
  rss: number,
): { armed: boolean; alert: boolean } {
  if (armed && rss >= MEMORY_ALERT_RSS_BYTES) return { armed: false, alert: true };
  if (!armed && rss < MEMORY_REARM_RSS_BYTES) return { armed: true, alert: false };
  return { armed, alert: false };
}

export function memoryAlertText(
  memory: IMemorySnapshot,
  jobs: IActiveMemoryJob[],
  now: number,
): string {
  const head =
    `Память процесса ${toMb(memory.rss)} МБ (порог ${toMb(MEMORY_ALERT_RSS_BYTES)}): ` +
    `heapTotal ${toMb(memory.heapTotal)}, heap ${toMb(memory.heapUsed)}, external ${toMb(memory.external)}, buffers ${toMb(memory.arrayBuffers)} МБ.`;
  if (!jobs.length) return `${head} Отслеживаемых задач нет.`;
  const list = jobs
    .map((job) => {
      const minutes = Math.round((now - job.startedAt) / 6000) / 10;
      return `${job.label} (${minutes} мин, со старта +${toMb(memory.rss - job.startRss)} МБ)`;
    })
    .join('; ');
  return `${head} Идут: ${list}`;
}

/** Своё имя — чтобы в журнале ошибок и в заголовке алерта не было безликого `Error`. */
export class MemoryPressureError extends Error {
  public readonly name = 'MemoryPressureError';
}

/** Только для тестов: очистить реестр между кейсами. */
export function resetMemoryJobsForTest(): void {
  active.clear();
}
