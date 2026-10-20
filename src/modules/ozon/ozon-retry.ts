import { type IRetryOptions, type TSleep, backoffDelay, realSleep } from '../yandex/yandex-retry';

import { OzonApiError } from './ozon.errors';

/**
 * Повтор запроса к Ozon Seller API.
 *
 * Параллельная версия withRetry (Яндекс) и withPolzaRetry, а не их обобщение:
 * те стоят под живыми отчётами и ИИ, менять их ради третьего клиента значит
 * рисковать первыми двумя. Общие только кирпичи — backoffDelay, TSleep.
 *
 * Повторяется ТОЛЬКО retryable: 429 (лимит метода на Client-Id), 5xx и
 * сетевой сбой. Пауза — Retry-After, если пришёл, иначе 1/2/4 с. Retry-After
 * длиннее MAX_RETRY_AFTER_MS не ждём: продавцу честнее сразу сказать «позже».
 */

export const OZON_RETRY: IRetryOptions = {
  attempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 4_000,
};

export const MAX_RETRY_AFTER_MS = 60_000;

export async function withOzonRetry<T>(
  operation: () => Promise<T>,
  options: IRetryOptions = OZON_RETRY,
  sleep: TSleep = realSleep,
  onRetry?: (error: OzonApiError, attempt: number, delayMs: number) => void,
): Promise<T> {
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof OzonApiError) || !error.retryable || attempt >= options.attempts) {
        throw error;
      }
      const delay = error.retryAfterMs ?? backoffDelay(attempt, options);
      if (delay > MAX_RETRY_AFTER_MS) throw error;

      onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
}
