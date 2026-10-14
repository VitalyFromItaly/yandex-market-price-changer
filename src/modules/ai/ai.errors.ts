import type { PolzaApiError } from './polza.errors';

import { PolzaModerationError } from './polza.errors';

/**
 * Отказы AiService — то, что случилось ДО запроса к Polza.
 *
 * НЕ наследники PolzaApiError: ErrorReporter ставит `source: 'polza'` по классу,
 * а закрытая фича или исчерпанный лимит — не сбой Polza и вообще не сбой.
 * Вызывающий показывает продавцу `userMessage` и в ErrorReporter их не шлёт.
 */
export class AiError extends Error {
  constructor(
    message: string,
    /** Текст для продавца — без внутренностей. */
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Фича `ai` продавцу закрыта. */
export class AiFeatureDisabledError extends AiError {
  constructor() {
    super(
      'ИИ: фича ai закрыта',
      'ИИ-функции для вас не включены. Если они нужны — напишите администратору.',
    );
  }
}

/** Продавец исчерпал дневной лимит расхода. */
export class AiDailyLimitError extends AiError {
  constructor(
    public readonly spentRub: number,
    public readonly limitRub: number,
  ) {
    super(
      `ИИ: дневной лимит ${limitRub} ₽ исчерпан (потрачено ${spentRub} ₽)`,
      'Дневной лимит ИИ-запросов исчерпан. Попробуйте завтра.',
    );
  }
}

/** ИИ выключен на сервере или лимит не удалось проверить. */
export class AiUnavailableError extends AiError {
  constructor(reason: string) {
    super(`ИИ недоступен: ${reason}`, 'ИИ временно недоступен. Попробуйте позже.');
  }
}

/**
 * Будить ли админов сбоем Polza.
 *
 * 403 — модерация отклонила содержимое продавца: поведение клиента, не поломка
 * (правило «4xx не алертит» в ErrorReporter). Всё прочее — 402 (кончились
 * деньги), 401 (ключ отозван), 400 (наш запрос составлен неверно), 429 после
 * повторов, 5xx, сеть — требует рук владельца. Поток одинаковых алертов
 * гасит AlertThrottle.
 */
export function shouldAlertPolzaError(error: PolzaApiError): boolean {
  return !(error instanceof PolzaModerationError);
}
