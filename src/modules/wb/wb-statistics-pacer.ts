import { createHash } from 'node:crypto';

/**
 * Лимит «Статистики» (и отчёта реализации «Финансов», переехавшего оттуда) — 1 запрос
 * в минуту на продавца. `withWbRetry` паузы длиннее 30 с не ждёт, поэтому интервал
 * выдерживается до вызова.
 */
export const WB_STATISTICS_INTERVAL_MS = 61_000;

/**
 * Сколько токенов помним. Запись старше интервала ничего не решает — её и
 * вытесняем первой; потолок нужен только против роста карты без конца.
 */
const MAX_TOKENS = 1000;

/**
 * Очередь вызовов статистики по токену. Лимит WB — на продавца, а клиент
 * создаётся на каждый вызов сервиса (фабрика не кэширует клиентов — довод
 * `WbClientFactory`): флаг внутри клиента не видел, что соседний экземпляр с тем
 * же токеном только что ходил в отчёт, и ночной проход по трём месяцам подряд
 * получал 429 на втором (прод 26-10-2026). Поэтому фабрика держит один
 * ограничитель на процесс и отдаёт его каждому клиенту.
 *
 * Ключ — sha256 токена, а не сам токен: карта живёт дольше клиента.
 * Слот резервируется до вызова — два клиента одного токена разом не уйдут
 * в WB одновременно, второй подождёт интервал.
 */
export class WbStatisticsPacer {
  private readonly slotAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Сколько ждать перед вызовом; заодно занимает слот — «отметить» отдельно не забыть. */
  reserve(token: string): number {
    const key = createHash('sha256').update(token).digest('hex');
    const now = this.now();
    const last = this.slotAt.get(key);
    const at = last === undefined ? now : Math.max(now, last + WB_STATISTICS_INTERVAL_MS);

    this.slotAt.delete(key);
    if (this.slotAt.size >= MAX_TOKENS) this.forgetStale(now);
    this.slotAt.set(key, at);
    return at - now;
  }

  /** Записи старше интервала; не нашлось — самая давняя (карта в порядке вставки). */
  private forgetStale(now: number): void {
    for (const [key, at] of this.slotAt) {
      if (now - at >= WB_STATISTICS_INTERVAL_MS) this.slotAt.delete(key);
    }
    if (this.slotAt.size >= MAX_TOKENS) {
      const [oldest] = this.slotAt.keys();
      this.slotAt.delete(oldest);
    }
  }
}
