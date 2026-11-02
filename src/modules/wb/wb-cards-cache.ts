import { createHash } from 'node:crypto';

/**
 * Сколько живёт прочитанный каталог карточек. Проход передачи остатков читает его
 * трижды за секунды (остатки, `writeTarget`, запись), а после прайса из бота — ещё и
 * сопоставление карточек; штрихкоды и размеры за минуты не меняются.
 */
export const WB_CARDS_TTL_MS = 5 * 60_000;

/** Сколько токенов помним — потолок против роста карты без конца, как у `WbStatisticsPacer`. */
const MAX_TOKENS = 1000;

interface IEntry<T> {
  at: number;
  value: Promise<T>;
}

/**
 * Каталог карточек по токену (решение `wb_cards_cache_per_token`). Полный обход
 * `content/v2/get/cards/list` три раза подряд ловил 429 content API (прод 406937947,
 * `stock-push:read:wb`), а клиент создаётся на каждый вызов сервиса — поэтому кэш,
 * как и `WbStatisticsPacer`, один на процесс в фабрике.
 *
 * Хранится промис: второй вызов, пришедший во время обхода, ждёт тот же обход, а не
 * начинает свой. Ошибка не кэшируется — следующий вызов идёт в WB заново. Ключ —
 * sha256 токена: карта живёт дольше клиента.
 */
export class WbCardsCache<T> {
  private readonly entries = new Map<string, IEntry<T>>();

  constructor(
    private readonly ttlMs: number = WB_CARDS_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(token: string, load: () => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(token).digest('hex');
    const now = this.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value;

    const value = load();
    this.entries.delete(key);
    if (this.entries.size >= MAX_TOKENS) this.forgetStale(now);
    this.entries.set(key, { at: now, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  /** Записи старше TTL; не нашлось — самая давняя (карта в порядке вставки). */
  private forgetStale(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= this.ttlMs) this.entries.delete(key);
    }
    if (this.entries.size >= MAX_TOKENS) {
      const [oldest] = this.entries.keys();
      this.entries.delete(oldest);
    }
  }
}
