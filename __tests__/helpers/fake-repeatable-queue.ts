import { vi } from 'vitest';

/**
 * Очередь-заглушка с ПОВЕДЕНИЕМ Bull 4 у повторяемых задач (TASK-157).
 *
 * Хранит то же, что Bull в Redis, — ключ `name:jobId:endDate:tz:cron`, — и в
 * `getRepeatableJobs` режет его по `:`, как `_keyToData` (lib/repeatable.js).
 * Прежние заглушки хранили id как есть, поэтому id с двоеточием
 * (`report:…`, `finance:…`) проходил тесты и ломался только на живом Redis.
 */

export interface IRepeatableView {
  key: string;
  name: string;
  id: string | null;
  endDate: number | null;
  tz: string | null;
  cron: string;
  next: number;
}

export type TInitialRepeatable = string | { name?: string; id: string; cron: string; tz?: string };

const DEFAULT_TZ = 'Europe/Moscow';

/** Ключ так, как его склеивает Bull (endDate пуст). */
export function bullRepeatKey(name: string, jobId: string, cron: string, tz = DEFAULT_TZ): string {
  return `${name}:${jobId}::${tz}:${cron}`;
}

/** Копия `_keyToData` Bull 4.16. */
function keyToData(key: string): IRepeatableView {
  const data = key.split(':');
  return {
    key,
    name: data[0],
    id: data[1] || null,
    endDate: parseInt(data[2], 10) || null,
    tz: data[3] || null,
    cron: data[4],
    next: 1,
  };
}

export function fakeRepeatableQueue(initial: TInitialRepeatable[] = [], defaultName = 'job') {
  const keys = initial.map((job) =>
    typeof job === 'string'
      ? job
      : bullRepeatKey(job.name ?? defaultName, job.id, job.cron, job.tz),
  );

  return {
    keys,
    /** Что вернул бы Bull прямо сейчас. */
    get repeatables(): IRepeatableView[] {
      return keys.map(keyToData);
    },
    add: vi.fn(async (name: string, data: unknown, opts: never) => {
      const o = opts as { jobId: string; repeat: { cron: string; tz?: string } };
      const key = bullRepeatKey(name, o.jobId, o.repeat.cron, o.repeat.tz);
      // Bull повторное заведение того же ключа не дублирует.
      if (!keys.includes(key)) keys.push(key);
      return { id: o.jobId, name, data };
    }),
    getRepeatableJobs: vi.fn(async () => keys.map(keyToData)),
    removeRepeatableByKey: vi.fn(async (key: string) => {
      const i = keys.indexOf(key);
      if (i >= 0) keys.splice(i, 1);
    }),
  };
}
