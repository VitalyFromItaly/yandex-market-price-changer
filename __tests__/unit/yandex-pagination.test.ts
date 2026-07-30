import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { YandexApiClient } from '../../src/modules/yandex/yandex-api.client';
import { PAGE_LIMITS, HISTORY_WINDOW_DAYS } from '../../src/modules/yandex/yandex-api.paths';
import { YandexAuthError, YandexRateLimitError } from '../../src/modules/yandex/yandex-api.errors';
import { backoffDelay, withRetry, DEFAULT_RETRY } from '../../src/modules/yandex/yandex-retry';
import {
  YandexDateRangeError,
  assertWithinHistoryWindow,
  splitIntoWindows,
  toDateParam,
} from '../../src/modules/yandex/yandex-date-window';

const BASE_URL = 'https://api.partner.market.yandex.ru';

/** Очередь ответов: страницы и ошибки отдаются по порядку. */
function stubAxios(script: Array<{ data?: unknown; status?: number }>) {
  const calls: Array<Record<string, unknown>> = [];
  let onError: (e: unknown) => unknown = (e) => {
    throw e;
  };
  let i = 0;

  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: {
          response: { use: (_ok: unknown, err: (e: unknown) => unknown) => (onError = err) },
        },
        get: async (path: string, opts: { params: Record<string, unknown> }) => {
          calls.push({ path, ...opts.params });
          const step = script[Math.min(i, script.length - 1)];
          i += 1;
          if (step.status) {
            const error: any = new Error('boom');
            error.config = { url: path };
            error.response = { status: step.status, data: undefined };
            return Promise.resolve(onError(error)).then(
              (v) => v,
              (e) => {
                throw e;
              },
            );
          }
          return { data: step.data };
        },
      }) as never,
  );

  return calls;
}

const CREDS = { token: 'ACMA:secret', campaignId: '12345', businessId: '67890' };

/** Пауз в тестах быть не должно — подменяем сон счётчиком. */
function client(script: Parameters<typeof stubAxios>[0], overrides = {}) {
  const calls = stubAxios(script);
  const slept: number[] = [];
  const instance = new YandexApiClient(CREDS, BASE_URL, {
    retry: { attempts: 4, baseDelayMs: 1000, maxDelayMs: 30_000 },
    sleep: async (ms) => {
      slept.push(ms);
    },
    ...overrides,
  });
  return { instance, calls, slept };
}

async function collect(gen: AsyncGenerator<unknown[], void, void>): Promise<unknown[]> {
  const all: unknown[] = [];
  for await (const page of gen) all.push(...page);
  return all;
}

describe('Постраничный обход', () => {
  afterEach(() => vi.restoreAllMocks());

  it('идёт по nextPageToken, пока он есть', async () => {
    const { instance, calls } = client([
      { data: { orders: [1, 2], paging: { nextPageToken: 'p2' } } },
      { data: { orders: [3, 4], paging: { nextPageToken: 'p3' } } },
      { data: { orders: [5] } },
    ]);

    expect(await collect(instance.iterateOrders())).toEqual([1, 2, 3, 4, 5]);
    expect(calls.map((c) => c.pageToken)).toEqual([undefined, 'p2', 'p3']);
  });

  it('не использует page и pageSize — они deprecated', async () => {
    const { instance, calls } = client([
      { data: { orders: [1], paging: { nextPageToken: 'p2' } } },
      { data: { orders: [2] } },
    ]);
    await collect(instance.iterateOrders());

    for (const call of calls) {
      expect(call).not.toHaveProperty('page');
      expect(call).not.toHaveProperty('pageSize');
    }
  });

  it('limit держится в границах метода на КАЖДОЙ странице', async () => {
    const { instance, calls } = client([
      { data: { orders: [1], paging: { nextPageToken: 'p2' } } },
      { data: { orders: [2] } },
    ]);
    await collect(instance.iterateOrders({ limit: 999 }));

    expect(calls.every((c) => c.limit === PAGE_LIMITS.orders.max)).toBe(true);
  });

  it('пустая страница не прерывает обход', async () => {
    // У Partner API страница может оказаться пустой при фильтре по статусу,
    // а nextPageToken при этом непустой.
    const { instance } = client([
      { data: { orders: [], paging: { nextPageToken: 'p2' } } },
      { data: { orders: [7] } },
    ]);

    expect(await collect(instance.iterateOrders())).toEqual([7]);
  });

  it('битый nextPageToken, указывающий сам на себя, не крутится вечно', async () => {
    // Иначе обход жёг бы часовую квоту до победного.
    const { instance, calls } = client(
      [{ data: { orders: [1], paging: { nextPageToken: 'same' } } }],
      {
        maxPages: 5,
      },
    );

    await collect(instance.iterateOrders());
    expect(calls).toHaveLength(5);
  });

  it('обрыв обхода по пределу страниц ЛОГИРУЕТСЯ как ошибка', async () => {
    // Молча оборвать — значит отдать неполный отчёт, выдав его за полный.
    const { instance } = client([{ data: { orders: [1], paging: { nextPageToken: 'same' } } }], {
      maxPages: 2,
    });

    const logged: string[] = [];
    Object.assign(instance as never as { logger: unknown }, {
      logger: {
        error: (m: string) => logged.push(m),
        warn: () => undefined,
        debug: () => undefined,
      },
    });

    await collect(instance.iterateOrders());
    expect(logged.join(' ')).toContain('неполный');
  });

  it('возвраты обходятся так же и со своим лимитом', async () => {
    // Возвраты приходят объектами и разбираются в IReturnRecord — см.
    // yandex-returns.test.ts; здесь проверяется только обход и лимит.
    const { instance, calls } = client([
      { data: { returns: [{ returnId: 1 }], paging: { nextPageToken: 'p2' } } },
      { data: { returns: [{ returnId: 2 }] } },
    ]);

    const items = await collect(instance.iterateReturns({ limit: 999 }));
    expect(items.map((r) => (r as { returnId: number }).returnId)).toEqual([1, 2]);
    expect(calls.every((c) => c.limit === PAGE_LIMITS.returns.max)).toBe(true);
  });

  it('обход не накапливает страницы в памяти — потребитель решает сам', async () => {
    // Генератор отдаёт страницу за страницей: следующий запрос уходит только
    // когда потребитель попросил очередную порцию.
    const { instance, calls } = client([
      { data: { orders: [1], paging: { nextPageToken: 'p2' } } },
      { data: { orders: [2], paging: { nextPageToken: 'p3' } } },
      { data: { orders: [3] } },
    ]);

    const gen = instance.iterateOrders();
    await gen.next();
    expect(calls).toHaveLength(1);
    await gen.next();
    expect(calls).toHaveLength(2);
  });
});

describe('Повтор при исчерпании квоты', () => {
  afterEach(() => vi.restoreAllMocks());

  it('420 приводит к паузе и повтору, а не к падению отчёта', async () => {
    const { instance, slept, calls } = client([
      { status: 420 },
      { status: 420 },
      { data: { orders: [1, 2] } },
    ]);

    expect(await collect(instance.iterateOrders())).toEqual([1, 2]);
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([1000, 2000]);
  });

  it('пауза растёт экспоненциально и упирается в потолок', () => {
    expect(backoffDelay(1, DEFAULT_RETRY)).toBe(1000);
    expect(backoffDelay(2, DEFAULT_RETRY)).toBe(2000);
    expect(backoffDelay(3, DEFAULT_RETRY)).toBe(4000);
    expect(backoffDelay(20, DEFAULT_RETRY)).toBe(DEFAULT_RETRY.maxDelayMs);
  });

  it('после исчерпания попыток ошибка пробрасывается', async () => {
    const { instance, slept } = client([{ status: 420 }]);

    await expect(collect(instance.iterateOrders())).rejects.toBeInstanceOf(YandexRateLimitError);
    expect(slept).toHaveLength(3); // 4 попытки — 3 паузы
  });

  it('401 НЕ повторяется — результат не изменится, а квота тратится', async () => {
    const { instance, slept, calls } = client([{ status: 401 }]);

    await expect(instance.getOrders()).rejects.toBeInstanceOf(YandexAuthError);
    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('400 не повторяется', async () => {
    const { instance, calls } = client([{ status: 400 }]);
    await expect(instance.getOrders()).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('5xx повторяется', async () => {
    const { instance, calls } = client([{ status: 503 }, { data: { orders: [9] } }]);
    expect((await instance.getOrders()).items).toEqual([9]);
    expect(calls).toHaveLength(2);
  });

  it('Retry-After от Яндекса важнее собственной экспоненты', async () => {
    const slept: number[] = [];
    let first = true;
    const result = await withRetry(
      async () => {
        if (first) {
          first = false;
          throw new YandexRateLimitError('quota', 420, { retryAfter: 7 });
        }
        return 'ok';
      },
      DEFAULT_RETRY,
      async (ms) => {
        slept.push(ms);
      },
    );

    expect(result).toBe('ok');
    expect(slept).toEqual([7000]);
  });
});

describe('Окно истории в 30 дней', () => {
  afterEach(() => vi.restoreAllMocks());

  const now = new Date('2026-07-29T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 3600_000);

  it('обычный период проходит', () => {
    expect(() => assertWithinHistoryWindow({ from: daysAgo(7), to: now }, now)).not.toThrow();
  });

  it('период ровно в 30 дней ещё допустим', () => {
    expect(() =>
      assertWithinHistoryWindow({ from: daysAgo(HISTORY_WINDOW_DAYS), to: now }, now),
    ).not.toThrow();
  });

  it('45 дней отклоняются с внятным текстом, а не необработанной ошибкой', () => {
    // Разбить на два окна можно, но во второе Яндекс всё равно вернёт пустоту:
    // данных старше 30 дней у него нет. Молча неполный отчёт хуже явной ошибки.
    let error: YandexDateRangeError;
    try {
      assertWithinHistoryWindow({ from: daysAgo(45), to: now }, now);
    } catch (e) {
      error = e as YandexDateRangeError;
    }

    expect(error!).toBeInstanceOf(YandexDateRangeError);
    expect(error!.userMessage).toContain('30');
    expect(error!.userMessage).toContain('45');
  });

  it('слишком старое начало периода отклоняется отдельно от его длины', () => {
    // Диапазон короткий, но целиком лежит за пределами хранения.
    const from = daysAgo(60);
    const to = daysAgo(55);
    expect(() => assertWithinHistoryWindow({ from, to }, now)).toThrow(YandexDateRangeError);
  });

  it('перевёрнутый и битый диапазон отклоняются', () => {
    expect(() => assertWithinHistoryWindow({ from: now, to: daysAgo(5) }, now)).toThrow(/позже/);
    expect(() => assertWithinHistoryWindow({ from: new Date('нет'), to: now }, now)).toThrow(
      /Некорректная/,
    );
  });

  it('проверка происходит ДО сетевого запроса — квота не тратится', async () => {
    const { instance, calls } = client([{ data: { orders: [] } }]);

    await expect(
      collect(instance.iterateOrdersInRange({ from: daysAgo(45), to: now }, {}, now)),
    ).rejects.toBeInstanceOf(YandexDateRangeError);
    expect(calls).toHaveLength(0);
  });

  it('даты уходят в формате DD-MM-YYYY, а не ISO', async () => {
    const { instance, calls } = client([{ data: { orders: [] } }]);
    await collect(
      instance.iterateOrdersInRange(
        { from: new Date('2026-07-05T00:00:00Z'), to: new Date('2026-07-29T00:00:00Z') },
        {},
        now,
      ),
    );

    expect(calls[0].fromDate).toBe('05-07-2026');
    expect(calls[0].toDate).toBe('29-07-2026');
  });

  it('toDateParam добивает нулями', () => {
    expect(toDateParam(new Date('2026-01-02T00:00:00Z'))).toBe('02-01-2026');
  });

  it('splitIntoWindows режет длинный период на окна', () => {
    // Нужно для истории по businesses, где ограничена длина, но не глубина.
    const windows = splitIntoWindows({ from: daysAgo(70), to: now });
    expect(windows).toHaveLength(3);
    expect(windows[0].from).toEqual(daysAgo(70));
    expect(windows[windows.length - 1].to).toEqual(now);
    // Окна стыкуются без дыр.
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i].from).toEqual(windows[i - 1].to);
    }
  });

  it('нулевой период даёт одно окно, а не пустой список', () => {
    expect(splitIntoWindows({ from: now, to: now })).toHaveLength(1);
  });
});
