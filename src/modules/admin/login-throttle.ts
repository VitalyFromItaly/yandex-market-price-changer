/**
 * Ограничитель попыток входа. Чистая логика: без Nest, без времени «изнутри».
 *
 * Зачем он вообще. Пароль один на всех администраторов и генерируется однажды —
 * это единственный секрет панели, за которой лежит переписка пользователей.
 * Без ограничителя его подбирают со скоростью сети, и никакая длина не спасает,
 * если проверок можно делать тысячу в секунду.
 *
 * `now` передаётся параметром, а не берётся из Date.now() внутри: иначе тест на
 * «через 15 минут блокировка снимается» пришлось бы писать через таймеры.
 */

/** Сколько промахов подряд допускается. */
export const MAX_ATTEMPTS = 5;

/** На сколько закрывается вход после исчерпания попыток. */
export const LOCK_MS = 15 * 60 * 1000;

interface IAttempts {
  failures: number;
  lockedUntil?: number;
}

export class LoginThrottle {
  private readonly attempts = new Map<string, IAttempts>();

  /** Сколько миллисекунд осталось до конца блокировки; 0 — не заблокирован. */
  lockedFor(login: string, now: number): number {
    const entry = this.attempts.get(login);
    if (!entry?.lockedUntil) return 0;

    const left = entry.lockedUntil - now;
    if (left > 0) return left;

    // Срок вышел — счётчик обнуляется, иначе следующий же промах снова
    // заблокировал бы вход, и «15 минут» превратились бы в «навсегда».
    this.attempts.delete(login);
    return 0;
  }

  /** Промах: наращивает счётчик и при переполнении включает блокировку. */
  registerFailure(login: string, now: number): void {
    const entry = this.attempts.get(login) ?? { failures: 0 };
    entry.failures += 1;

    if (entry.failures >= MAX_ATTEMPTS) {
      entry.lockedUntil = now + LOCK_MS;
    }

    this.attempts.set(login, entry);
  }

  /** Успешный вход стирает историю промахов. */
  registerSuccess(login: string): void {
    this.attempts.delete(login);
  }
}

/** Округление вверх до минут — для сообщения пользователю. */
export function minutesLeft(ms: number): number {
  return Math.ceil(ms / 60000);
}
