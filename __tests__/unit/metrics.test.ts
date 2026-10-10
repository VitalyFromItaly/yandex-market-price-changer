import { describe, expect, it, vi } from 'vitest';

import { latArray } from '../../src/database/services/telegram-api-bucket.service';
import {
  HISTOGRAM_SIZE,
  HOUR_MS,
  MINUTE_MS,
  addHistograms,
  emptyHistogram,
  histogramPercentile,
  latencyBucketIndex,
  outcomeOf,
  percentile,
  shouldAlertTelegramError,
  summarizeApi,
  summarizeProbe,
  summarizeUpdates,
  telegramErrorInfo,
  timelineSlots,
} from '../../src/modules/metrics/metrics.domain';
import { TelegramApiMetrics } from '../../src/modules/telegram/bots/telegram-api-metrics.service';
import { markRefused, refusedOf } from '../../src/modules/telegram/bots/shared/action-log.domain';

function histogramOf(...ms: number[]): number[] {
  const histogram = emptyHistogram();
  for (const value of ms) histogram[latencyBucketIndex(value)] += 1;
  return histogram;
}

describe('гистограмма задержек', () => {
  it('граница корзины включительна, переполнение — последняя корзина', () => {
    expect(latencyBucketIndex(0)).toBe(0);
    expect(latencyBucketIndex(50)).toBe(0);
    expect(latencyBucketIndex(51)).toBe(1);
    expect(latencyBucketIndex(60_000)).toBe(HISTOGRAM_SIZE - 1);
  });

  it('перцентиль — верхняя граница корзины, не выше наблюдённого максимума', () => {
    const histogram = histogramOf(80, 90, 95, 99, 260);
    expect(histogramPercentile(histogram, 0.5, 260)).toBe(100);
    expect(histogramPercentile(histogram, 0.95, 260)).toBe(260);
    expect(histogramPercentile(emptyHistogram(), 0.5, 0)).toBeNull();
  });

  it('переполнение отдаёт максимум, а не бесконечность', () => {
    expect(histogramPercentile(histogramOf(45_000), 0.95, 45_000)).toBe(45_000);
  });

  it('битая гистограмма из базы дополняется нулями, а не роняет свёртку', () => {
    const into = emptyHistogram();
    addHistograms(into, [1, Number.NaN, 2]);
    expect(into.slice(0, 3)).toEqual([1, 0, 2]);
    expect(into).toHaveLength(HISTOGRAM_SIZE);
  });

  it('точный перцентиль по сырым значениям', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([], 0.5)).toBeNull();
  });

  it('lat из базы: объект с числовыми ключами приводится к массиву', () => {
    expect(latArray({ '0': 3, '2': 1 })).toEqual([3, 0, 1]);
    expect(latArray([1, 2])).toEqual([1, 2]);
    expect(latArray(null)).toEqual([]);
  });
});

describe('ответ Telegram', () => {
  const telegramError = (code: number, parameters?: object) =>
    Object.assign(new Error(`${code}: x`), {
      response: { error_code: code, description: 'x', parameters },
    });

  it('код, описание и retry_after достаются из response', () => {
    expect(telegramErrorInfo(telegramError(429, { retry_after: 12 }))).toEqual({
      code: 429,
      description: 'x',
      retryAfter: 12,
    });
  });

  it('исход: ok, код строкой, network без ответа', () => {
    expect(outcomeOf(undefined)).toBe('ok');
    expect(outcomeOf(telegramError(403))).toBe('403');
    expect(outcomeOf(new Error('ETIMEDOUT'))).toBe('network');
  });

  it('403 и 400 админов не будят, 429/5xx/сеть — будят', () => {
    expect(shouldAlertTelegramError({ code: 403 })).toBe(false);
    expect(shouldAlertTelegramError({ code: 400 })).toBe(false);
    expect(shouldAlertTelegramError({ code: 429 })).toBe(true);
    expect(shouldAlertTelegramError({ code: 502 })).toBe(true);
    expect(shouldAlertTelegramError({})).toBe(true);
  });
});

describe('summarizeApi', () => {
  const since = 0;
  const slots = timelineSlots(since, 2 * HOUR_MS, HOUR_MS);

  it('getUpdates считается в вызовах, но не в задержке', () => {
    const summary = summarizeApi(
      [
        {
          minute: 0,
          botId: '1',
          method: 'getUpdates',
          outcome: 'ok',
          count: 10,
          sumMs: 500_000,
          maxMs: 50_000,
          lat: histogramOf(50_000),
        },
        {
          minute: MINUTE_MS,
          botId: '1',
          method: 'sendMessage',
          outcome: 'ok',
          count: 4,
          sumMs: 800,
          maxMs: 280,
          lat: histogramOf(150, 180, 190, 280),
        },
      ],
      slots,
      HOUR_MS,
    );

    expect(summary.total).toBe(14);
    expect(summary.p95).toBe(280);
    const getUpdates = summary.methods.find((m) => m.method === 'getUpdates');
    expect(getUpdates?.p95).toBeNull();
    expect(getUpdates?.count).toBe(10);
  });

  it('ошибки — по исходу и в таймлайне по своему столбцу', () => {
    const summary = summarizeApi(
      [
        {
          minute: HOUR_MS + MINUTE_MS,
          botId: '1',
          method: 'sendMessage',
          outcome: '403',
          count: 2,
          sumMs: 200,
          maxMs: 120,
          lat: histogramOf(80, 120),
        },
        {
          minute: HOUR_MS + 2 * MINUTE_MS,
          botId: '1',
          method: 'sendMessage',
          outcome: 'network',
          count: 1,
          sumMs: 5000,
          maxMs: 5000,
          lat: histogramOf(5000),
        },
      ],
      slots,
      HOUR_MS,
    );

    expect(summary.errors).toBe(3);
    expect(summary.network).toBe(1);
    expect(summary.methods[0].byOutcome).toEqual({ '403': 2, network: 1 });
    expect(summary.timeline).toEqual([
      { at: 0, calls: 0, errors: 0, network: 0 },
      { at: HOUR_MS, calls: 3, errors: 3, network: 1 },
    ]);
  });
});

describe('summarizeProbe', () => {
  it('задержки, доля аварий и последний образец', () => {
    const slots = timelineSlots(0, HOUR_MS, HOUR_MS);
    const summary = summarizeProbe(
      'telegram',
      [
        { at: 1, key: 'telegram', state: 'ok', latencyMs: 200 },
        { at: 2, key: 'yandex', state: 'ok', latencyMs: 9999 },
        { at: 3, key: 'telegram', state: 'down', latencyMs: 5000 },
      ],
      slots,
      HOUR_MS,
    );

    expect(summary.samples).toBe(2);
    expect(summary.down).toBe(1);
    expect(summary.maxMs).toBe(5000);
    expect(summary.last).toEqual({ at: 3, state: 'down', latencyMs: 5000 });
    expect(summary.timeline).toEqual([{ at: 0, avgMs: 2600, down: 1 }]);
  });
});

describe('summarizeUpdates', () => {
  it('по видам, отказы гейтов, уникальные продавцы и самые медленные', () => {
    const slots = timelineSlots(0, HOUR_MS, HOUR_MS);
    const summary = summarizeUpdates(
      [
        { createdAt: 1, telegramUserId: 'a', kind: 'menu', status: 'ok', durationMs: 100 },
        { createdAt: 2, telegramUserId: 'a', kind: 'menu', status: 'error', durationMs: 900 },
        {
          createdAt: 3,
          telegramUserId: 'b',
          kind: 'callback',
          status: 'ok',
          durationMs: 20,
          refusedBy: 'feature',
        },
      ],
      slots,
      HOUR_MS,
    );

    expect(summary.updates).toBe(3);
    expect(summary.errors).toBe(1);
    expect(summary.users).toBe(2);
    expect(summary.refused).toEqual({ feature: 1 });
    expect(summary.kinds[0]).toMatchObject({ kind: 'menu', count: 2, errors: 1, p95: 900 });
    expect(summary.slowest[0].durationMs).toBe(900);
    expect(summary.timeline).toEqual([{ at: 0, updates: 3, errors: 1 }]);
  });
});

describe('отказ гейта в ctx.state', () => {
  it('гейт помечает, журнал читает; чужое значение игнорируется', () => {
    const state: Record<string, unknown> = {};
    expect(refusedOf(state)).toBeUndefined();
    markRefused(state, 'access');
    expect(refusedOf(state)).toBe('access');
    expect(refusedOf({ refusedBy: 'whatever' })).toBeUndefined();
  });
});

describe('TelegramApiMetrics', () => {
  it('копит минуту в памяти и сливает одним вызовом', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const metrics = new TelegramApiMetrics({ flush } as never);

    metrics.observe('1', 'sendMessage', 'ok', 120, 10 * MINUTE_MS + 5);
    metrics.observe('1', 'sendMessage', 'ok', 80, 10 * MINUTE_MS + 30_000);
    metrics.observe('1', 'sendMessage', '403', 60, 10 * MINUTE_MS + 40_000);
    await metrics.flush();

    expect(flush).toHaveBeenCalledTimes(1);
    const batch = flush.mock.calls[0][0];
    expect(batch).toHaveLength(2);
    const ok = batch.find((b: { outcome: string }) => b.outcome === 'ok');
    expect(ok).toMatchObject({ minute: 10 * MINUTE_MS, count: 2, sumMs: 200, maxMs: 120 });

    // Слитое не сливается второй раз.
    await metrics.flush();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('сбой записи не бросает и сбрасывает накопленное', async () => {
    const flush = vi.fn().mockRejectedValue(new Error('mongo недоступна'));
    const metrics = new TelegramApiMetrics({ flush } as never);

    metrics.observe('1', 'getMe', 'ok', 10);
    await expect(metrics.flush()).resolves.toBeUndefined();
    await metrics.flush();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
