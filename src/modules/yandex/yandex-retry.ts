import { YandexApiError, YandexRateLimitError } from './yandex-api.errors';

/**
 * Повтор запроса с экспоненциальной паузой.
 *
 * Нужен из-за 420: у Partner API это не «слишком много запросов подряд», а
 * исчерпание ЧАСОВОЙ квоты метода (10 000 у orders, 5 000 у returns). Отчёт,
 * который упал на середине пагинации из-за квоты, — это отчёт, который
 * пользователь не получил вовсе; повтор с паузой почти всегда его спасает.
 *
 * Повторяем ТОЛЬКО то, что помечено retryable (420/429, 5xx, обрыв связи).
 * Повторять 401 или 400 бессмысленно: результат не изменится, а каждая попытка
 * жжёт ту же квоту.
 */

export interface IRetryOptions {
  /** Сколько всего попыток, включая первую. */
  attempts: number;
  /** База экспоненты: 1-я пауза = base, 2-я = base×2, 3-я = base×4. */
  baseDelayMs: number;
  /** Потолок паузы — иначе шестая попытка ждёт полчаса. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY: IRetryOptions = {
  attempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

export type TSleep = (ms: number) => Promise<void>;

export const realSleep: TSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function backoffDelay(attempt: number, options: IRetryOptions = DEFAULT_RETRY): number {
  const delay = options.baseDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, options.maxDelayMs);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: IRetryOptions = DEFAULT_RETRY,
  sleep: TSleep = realSleep,
  onRetry?: (error: YandexApiError, attempt: number, delayMs: number) => void,
): Promise<T> {
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      const apiError = error as YandexApiError;
      const retryable = apiError instanceof YandexApiError && apiError.retryable;

      if (!retryable || attempt >= options.attempts) throw error;

      // Если Яндекс сам сказал, когда возвращаться, — слушаем его, а не свою
      // экспоненту: она может оказаться и короче, и заметно длиннее нужного.
      const delay = retryAfterMs(apiError) ?? backoffDelay(attempt, options);
      onRetry?.(apiError, attempt, delay);
      await sleep(delay);
    }
  }
}

/** `Retry-After` приходит в секундах; у 420 Яндекс его обычно не шлёт. */
function retryAfterMs(error: YandexApiError): number | null {
  if (!(error instanceof YandexRateLimitError)) return null;
  const header = (error.payload as { retryAfter?: unknown })?.retryAfter;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}
