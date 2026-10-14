import { type IRetryOptions, type TSleep, backoffDelay, realSleep } from '../yandex/yandex-retry';

import { PolzaApiError } from './polza.errors';

/**
 * Повтор запроса к Polza.ai.
 *
 * Параллельная версия withRetry из yandex-retry, а не его обобщение: тот
 * завязан на YandexApiError и стоит под всеми отчётами — менять его ради
 * второго клиента значит рисковать первым. Общие только чистые кирпичи:
 * backoffDelay, TSleep.
 *
 * Повторяется ТОЛЬКО retryable (429, 408, 502, 503). Пауза — Retry-After, если
 * сервер его прислал, иначе экспонента 1/2/4 с. Retry-After длиннее
 * MAX_RETRY_AFTER_MS не ждём вовсе: воркер, который минуты спит ради одного
 * ответа ИИ, держит очередь, а продавцу честнее сразу сказать «позже».
 */

export const POLZA_RETRY: IRetryOptions = {
  attempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 4_000,
};

export const MAX_RETRY_AFTER_MS = 60_000;

export async function withPolzaRetry<T>(
  operation: () => Promise<T>,
  options: IRetryOptions = POLZA_RETRY,
  sleep: TSleep = realSleep,
  onRetry?: (error: PolzaApiError, attempt: number, delayMs: number) => void,
): Promise<T> {
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof PolzaApiError) || !error.retryable || attempt >= options.attempts) {
        throw error;
      }
      const delay = error.retryAfterMs ?? backoffDelay(attempt, options);
      if (delay > MAX_RETRY_AFTER_MS) throw error;

      onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
}
