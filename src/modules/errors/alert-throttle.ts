/**
 * Ограничитель алертов. Чистая логика: без Nest и без времени «изнутри».
 *
 * Зачем. Один упавший внешний сервис даёт не одну ошибку, а поток: Partner API
 * отвечает 429 на каждый запрос отчёта, и без ограничителя администратор
 * получит сотню одинаковых сообщений за минуту. Итог предсказуем — алерты
 * перестают читать вообще, то есть ловитель ошибок делает наблюдаемость хуже,
 * чем её отсутствие.
 *
 * `now` передаётся параметром, а не берётся из Date.now(): иначе тест на
 * «через 15 минут алерт снова проходит» пришлось бы писать через таймеры.
 */

/** Как часто можно повторять алерт об одной и той же ошибке. */
export const ALERT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Сколько разных ключей помним. Без потолка карта растёт неограниченно:
 * ключ содержит место ошибки, а мест конечное число — но опечатка в context,
 * собранном из данных, легко сделает их бесконечными.
 */
const MAX_KEYS = 500;

export class AlertThrottle {
  private readonly sentAt = new Map<string, number>();

  /**
   * Пропустить ли алерт. Заодно отмечает отправку — отдельный «зафиксировать»
   * было бы легко забыть вызвать, и тогда ограничитель молча не работает.
   */
  allow(key: string, now: number): boolean {
    const last = this.sentAt.get(key);
    if (last !== undefined && now - last < ALERT_WINDOW_MS) return false;

    if (this.sentAt.size >= MAX_KEYS) this.forgetOldest();
    this.sentAt.set(key, now);
    return true;
  }

  /** Вытесняет самый давний ключ, когда карта упёрлась в потолок. */
  private forgetOldest(): void {
    let oldestKey: string | undefined;
    let oldestAt = Infinity;

    for (const [key, at] of this.sentAt) {
      if (at < oldestAt) {
        oldestAt = at;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) this.sentAt.delete(oldestKey);
  }
}
