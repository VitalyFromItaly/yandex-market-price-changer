import { describe, it, expect, vi } from 'vitest';

import { MAX_RETRY_AFTER_MS, withPolzaRetry } from '../../src/modules/ai/polza-retry';
import {
  PolzaApiError,
  PolzaAuthError,
  PolzaInsufficientFundsError,
  PolzaModerationError,
  PolzaNetworkError,
  PolzaRateLimitError,
  PolzaServerError,
  parseRetryAfter,
  toPolzaApiError,
} from '../../src/modules/ai/polza.errors';

describe('toPolzaApiError: класс по коду ответа', () => {
  const cases: Array<[number | undefined, new (...a: never[]) => PolzaApiError, boolean]> = [
    [undefined, PolzaNetworkError, false],
    [400, PolzaApiError, false],
    [401, PolzaAuthError, false],
    [402, PolzaInsufficientFundsError, false],
    [403, PolzaModerationError, false],
    [404, PolzaApiError, false],
    [408, PolzaServerError, true],
    [409, PolzaApiError, false],
    [413, PolzaApiError, false],
    [429, PolzaRateLimitError, true],
    [500, PolzaApiError, false],
    [502, PolzaServerError, true],
    [503, PolzaServerError, true],
  ];

  it.each(cases)('%s → %o, retryable=%s', (status, cls, retryable) => {
    const error = toPolzaApiError(status, undefined, undefined, 'boom');
    expect(error).toBeInstanceOf(cls);
    expect(error.constructor).toBe(cls);
    expect(error.retryable).toBe(retryable);
    expect(error.status).toBe(status ?? 0);
  });

  it('вложенное тело документации: code, message, trace_id', () => {
    const error = toPolzaApiError(
      402,
      {
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Недостаточно средств',
          metadata: { raw: 'x'.repeat(5000) },
        },
        trace_id: 'tr-42',
      },
      undefined,
      'fallback',
    );
    expect(error.message).toBe('Недостаточно средств');
    expect(error.code).toBe('INSUFFICIENT_BALANCE');
    expect(error.traceId).toBe('tr-42');
    // Сырой ответ провайдера с ошибкой не едет.
    expect(JSON.stringify(error)).not.toContain('xxxxx');
  });

  it('плоское тело тоже читается', () => {
    const error = toPolzaApiError(
      400,
      { code: 'BAD_REQUEST', message: 'bad', trace_id: 't' },
      undefined,
      'f',
    );
    expect([error.code, error.message, error.traceId]).toEqual(['BAD_REQUEST', 'bad', 't']);
  });

  it('без тела — запасной текст', () => {
    expect(toPolzaApiError(500, 'Bad Gateway html', undefined, 'Request failed').message).toBe(
      'Request failed',
    );
  });

  it('Retry-After попадает в 429 и 503', () => {
    expect(toPolzaApiError(429, {}, '3', 'f').retryAfterMs).toBe(3000);
    expect(toPolzaApiError(503, {}, '7', 'f').retryAfterMs).toBe(7000);
  });

  it('withRequest склеивает метод и путь', () => {
    expect(new PolzaApiError('x', 500).withRequest('post', '/v1/chat/completions').request).toBe(
      'POST /v1/chat/completions',
    );
  });
});

describe('parseRetryAfter', () => {
  it('секунды и HTTP-дата', () => {
    const now = Date.parse('2026-10-14T10:00:00Z');
    expect(parseRetryAfter('2', now)).toBe(2000);
    expect(parseRetryAfter('Wed, 14 Oct 2026 10:00:05 GMT', now)).toBe(5000);
  });

  it('мусор и пустота — как отсутствие', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('скоро')).toBeUndefined();
    expect(parseRetryAfter('-1')).toBeUndefined();
  });
});

describe('withPolzaRetry', () => {
  const sleep = () => vi.fn().mockResolvedValue(undefined);

  it('повторяет retryable и отдаёт успех', async () => {
    const s = sleep();
    const op = vi
      .fn()
      .mockRejectedValueOnce(new PolzaServerError('bad gw', 502))
      .mockResolvedValue('ok');
    await expect(withPolzaRetry(op, undefined, s)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
    expect(s).toHaveBeenCalledWith(1000);
  });

  it('не retryable — один вызов', async () => {
    const op = vi.fn().mockRejectedValue(new PolzaInsufficientFundsError('no money', 402));
    await expect(withPolzaRetry(op, undefined, sleep())).rejects.toBeInstanceOf(
      PolzaInsufficientFundsError,
    );
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('Retry-After длиннее потолка — не ждём', async () => {
    const s = sleep();
    const op = vi
      .fn()
      .mockRejectedValue(
        new PolzaServerError('busy', 503, undefined, undefined, MAX_RETRY_AFTER_MS + 1),
      );
    await expect(withPolzaRetry(op, undefined, s)).rejects.toBeInstanceOf(PolzaServerError);
    expect(op).toHaveBeenCalledTimes(1);
    expect(s).not.toHaveBeenCalled();
  });

  it('чужие ошибки не повторяются', async () => {
    const op = vi.fn().mockRejectedValue(new TypeError('bug'));
    await expect(withPolzaRetry(op, undefined, sleep())).rejects.toBeInstanceOf(TypeError);
    expect(op).toHaveBeenCalledTimes(1);
  });
});
