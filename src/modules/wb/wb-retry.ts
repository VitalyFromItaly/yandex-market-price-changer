import { type IRetryOptions, type TSleep, backoffDelay, realSleep } from '../yandex/yandex-retry';

import { WbApiError } from './wb.errors';

/**
 * Повтор запроса к WB API — параллельная версия withOzonRetry, а не её
 * обобщение (довод `ozon-retry.ts`). Повторяется ТОЛЬКО retryable: 429, 5xx и
 * сетевой сбой. Пауза — заголовок WB, если пришёл, иначе 1/2/4 с; пауза
 * длиннее MAX_RETRY_AFTER_MS не ждётся — продавцу честнее сразу сказать «позже».
 */

export const WB_RETRY: IRetryOptions = {
  attempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 4_000,
};

export const MAX_RETRY_AFTER_MS = 30_000;

export async function withWbRetry<T>(
  operation: () => Promise<T>,
  options: IRetryOptions = WB_RETRY,
  sleep: TSleep = realSleep,
  onRetry?: (error: WbApiError, attempt: number, delayMs: number) => void,
): Promise<T> {
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof WbApiError) || !error.retryable || attempt >= options.attempts) {
        throw error;
      }
      const delay = error.retryAfterMs ?? backoffDelay(attempt, options);
      if (delay > MAX_RETRY_AFTER_MS) throw error;

      onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
}
