import { describe, it, expect, vi } from 'vitest';

import {
  ErrorReporter,
  SYSTEM_USER,
} from '../../src/modules/errors/error-reporter.service';
import { AlertThrottle, ALERT_WINDOW_MS } from '../../src/modules/errors/alert-throttle';
import { YandexRateLimitError, YandexApiError } from '../../src/modules/yandex/yandex-api.errors';

/**
 * Ловитель ошибок. Проверяется в первую очередь то, что он НЕ должен делать:
 * ронять приложение, задерживать ответ и спамить администратора.
 */
describe('AlertThrottle', () => {
  const NOW = 1_700_000_000_000;

  it('первый алерт проходит', () => {
    expect(new AlertThrottle().allow('a', NOW)).toBe(true);
  });

  it('повтор в окне не проходит', () => {
    // Один упавший внешний сервис даёт поток одинаковых ошибок; без этого
    // администратор получит сотню сообщений и перестанет читать алерты вовсе.
    const throttle = new AlertThrottle();
    throttle.allow('a', NOW);
    expect(throttle.allow('a', NOW + ALERT_WINDOW_MS - 1)).toBe(false);
  });

  it('после окна снова проходит', () => {
    const throttle = new AlertThrottle();
    throttle.allow('a', NOW);
    expect(throttle.allow('a', NOW + ALERT_WINDOW_MS)).toBe(true);
  });

  it('ключи независимы', () => {
    const throttle = new AlertThrottle();
    throttle.allow('a', NOW);
    expect(throttle.allow('b', NOW)).toBe(true);
  });
});

describe('ErrorReporter', () => {
  function build(record = vi.fn().mockResolvedValue(undefined)) {
    const reporter = new ErrorReporter({ record } as never);
    const send = vi.fn().mockResolvedValue(undefined);
    reporter.setAlertSender(send);
    return { reporter, record, send };
  }

  it('записывает ошибку с классом, стеком и местом', async () => {
    const { reporter, record } = build();

    await reporter.report({
      error: new TypeError('x is not a function'),
      source: 'bot',
      context: 'report:profit',
      telegramUserId: '777',
    });

    const entry = record.mock.calls[0][0];
    expect(entry.status).toBe('error');
    expect(entry.kind).toBe('error');
    expect(entry.errorType).toBe('TypeError');
    expect(entry.error).toContain('x is not a function');
    expect(entry.stack).toContain('TypeError');
    expect(entry.context).toBe('report:profit');
    expect(entry.telegramUserId).toBe('777');
  });

  it('без пользователя запись достаётся system, а не пустой строке', async () => {
    // Пустая строка совпала бы с фильтром «все» и молча испортила выборку.
    const { reporter, record } = build();
    await reporter.report({ error: new Error('boom'), source: 'http', context: 'http:GET /api' });
    expect(record.mock.calls[0][0].telegramUserId).toBe(SYSTEM_USER);
  });

  it('ошибка Яндекса приносит статус, адрес запроса и свой source', async () => {
    // Ровно это отвечает на вопрос «на каком запросе упало»: до появления
    // withRequest адрес терялся и жил только в тексте лог-строки.
    const { reporter, record } = build();
    const error = new YandexRateLimitError('too many requests', 429).withRequest(
      'get',
      'v2/campaigns/123/orders',
    );

    await reporter.report({ error, source: 'bot', context: 'report:profit' });

    const entry = record.mock.calls[0][0];
    expect(entry.source).toBe('yandex');
    expect(entry.errorType).toBe('YandexRateLimitError');
    expect(entry.httpStatus).toBe(429);
    expect(entry.requestUrl).toBe('GET v2/campaigns/123/orders');
  });

  it('вырезает подписанный токен, но НЕ трогает числа', async () => {
    // Числовая маска изуродовала бы коды ответов и суммы в тексте ошибки.
    const { reporter, record } = build();
    await reporter.report({
      error: new Error('отказ при token: ACMA5ba7c9d1e2f3a4b5c6, статус 429'),
      source: 'bot',
      context: 'test',
    });

    const entry = record.mock.calls[0][0];
    expect(entry.error).not.toContain('ACMA5ba7c9d1');
    expect(entry.error).toContain('429');
  });

  it('НЕ бросает, когда падает сама запись', async () => {
    // Ловитель, роняющий приложение, хуже отсутствующего.
    const { reporter } = build(vi.fn().mockRejectedValue(new Error('mongo недоступна')));
    await expect(
      reporter.report({ error: new Error('boom'), source: 'bot', context: 'test' }),
    ).resolves.toBeUndefined();
  });

  it('переживает то, что вообще не является ошибкой', async () => {
    const { reporter, record } = build();
    await reporter.report({ error: 'просто строка', source: 'process', context: 'test' });

    const entry = record.mock.calls[0][0];
    expect(entry.errorType).toBe('StringError');
    expect(entry.error).toContain('просто строка');
  });

  it('шлёт алерт один раз на одинаковые ошибки подряд', async () => {
    const { reporter, send } = build();
    const report = () =>
      reporter.report({ error: new Error('boom'), source: 'bot', context: 'report:profit' });

    await report();
    await report();
    await report();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('разные места шлют разные алерты', async () => {
    const { reporter, send } = build();
    await reporter.report({ error: new Error('boom'), source: 'bot', context: 'report:profit' });
    await reporter.report({ error: new Error('boom'), source: 'bot', context: 'stock-upload' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('alert: false отключает уведомление, но не запись', async () => {
    const { reporter, send, record } = build();
    await reporter.report({
      error: new Error('redis'),
      source: 'queue',
      context: 'queue:redis',
      alert: false,
    });

    expect(send).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('сбой отправки алерта не ломает запись', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const reporter = new ErrorReporter({ record } as never);
    reporter.setAlertSender(() => Promise.reject(new Error('403')));

    await expect(
      reporter.report({ error: new Error('boom'), source: 'bot', context: 'test' }),
    ).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('без подставленного отправителя работает молча', async () => {
    // До bootstrap телеграм-слой ещё не подставил отправителя, а ошибки
    // случаются и на старте.
    const record = vi.fn().mockResolvedValue(undefined);
    const reporter = new ErrorReporter({ record } as never);

    await expect(
      reporter.report({ error: new Error('boom'), source: 'process', context: 'startup' }),
    ).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe('YandexApiError.withRequest', () => {
  it('склеивает метод и путь в верхнем регистре', () => {
    const error = new YandexApiError('x', 500).withRequest('post', 'v2/offers');
    expect(error.request).toBe('POST v2/offers');
  });

  it('без данных ничего не выдумывает', () => {
    const error = new YandexApiError('x', 500).withRequest(undefined, undefined);
    expect(error.request).toBeUndefined();
  });

  it('возвращает саму ошибку — чтобы использовать в return', () => {
    const error = new YandexApiError('x', 500);
    expect(error.withRequest('get', 'v2/x')).toBe(error);
  });
});
