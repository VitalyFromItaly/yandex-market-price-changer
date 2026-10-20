import { parseRetryAfter } from '../ozon/ozon.errors';

/**
 * Доменные ошибки WB API — по образцу OzonApiError.
 *
 * Тело ошибки WB — `{status, statusText, title, detail, requestId, origin}`
 * (проверено живым запросом 18-10-2026: без токена — 401 «invalid API access
 * token: empty main token», с мусором — «token is malformed: token contains an
 * invalid number of segments»). Хранятся код, текст и requestId: токена в них нет.
 */
export class WbApiError extends Error {
  constructor(
    message: string,
    /** HTTP-код ответа. 0 — ответа не было вовсе. */
    public readonly status: number,
    /** `requestId` WB — по нему поддержка WB находит запрос. */
    public readonly requestId?: string,
    /** Сколько ждать перед повтором, если WB прислал заголовок. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }

  /** Запрос, на котором сломалось: `GET https://content-api.wildberries.ru/ping`. */
  public request?: string;

  public withRequest(method: string | undefined, url: string | undefined): this {
    const parts = [method?.toUpperCase(), url].filter(Boolean);
    if (parts.length) this.request = parts.join(' ');
    return this;
  }

  public get retryable(): boolean {
    return false;
  }

  /** Текст для продавца — без внутренностей и без токена. */
  public get userMessage(): string {
    return 'Wildberries сейчас не отвечает. Попробуйте позже.';
  }
}

/**
 * 401/403 — токен неверен, отозван, истёк или не открывает эту категорию API.
 * Какое из этого — решает вызывающий по набору категорий: отказ на всех —
 * токен не работает, на части — не хватает прав.
 */
export class WbAuthError extends WbApiError {
  public get userMessage(): string {
    return (
      'Wildberries не принял токен. Проверьте его в личном кабинете WB (Настройки → ' +
      'Доступ к API): токен должен быть действующим и не тестовым.'
    );
  }
}

/** 429 — лимит запросов метода (у `/ping` — 3 запроса за 30 секунд на хост). */
export class WbRateLimitError extends WbApiError {
  public get retryable(): boolean {
    return true;
  }
}

/** 5xx — сбой на стороне WB. */
export class WbServerError extends WbApiError {
  public get retryable(): boolean {
    return true;
  }
}

/** Ответа не было: таймаут, обрыв, DNS. Повторяется — запросы читающие. */
export class WbNetworkError extends WbApiError {
  constructor(message: string) {
    super(message, 0);
  }

  public get retryable(): boolean {
    return true;
  }
}

/**
 * Ответ пришёл, но собрать его целиком нельзя: статистика отдала полную
 * страницу, а курсор (`lastChangeDate`, `rrd_id`) не сдвинулся, или кончился
 * потолок страниц. Вернуть то, что успели, — значит молча недосчитать.
 */
export class WbIncompleteResponseError extends WbApiError {
  constructor(
    message: string,
    /** Что не собралось — для текста продавцу. */
    private readonly subject = 'список заказов',
  ) {
    super(message, 200);
  }

  public get userMessage(): string {
    return `Wildberries отдал неполный ${this.subject}. Попробуйте позже или за период покороче.`;
  }
}

/**
 * Ответ → класс ошибки. Паузу WB присылает в `X-Ratelimit-Retry` (секунды),
 * стандартный `Retry-After` тоже читается.
 */
export function toWbApiError(
  status: number | undefined,
  payload: unknown,
  retryAfterHeader: unknown,
  fallbackMessage: string,
): WbApiError {
  if (!status) return new WbNetworkError(fallbackMessage);

  const body = (payload ?? {}) as { detail?: unknown; title?: unknown; requestId?: unknown };
  const text =
    (typeof body.detail === 'string' && body.detail) ||
    (typeof body.title === 'string' && body.title) ||
    fallbackMessage;
  const requestId = typeof body.requestId === 'string' ? body.requestId : undefined;

  if (status === 401 || status === 403) return new WbAuthError(text, status, requestId);
  if (status === 429) {
    return new WbRateLimitError(text, status, requestId, parseRetryAfter(retryAfterHeader));
  }
  if (status >= 500) {
    return new WbServerError(text, status, requestId, parseRetryAfter(retryAfterHeader));
  }
  return new WbApiError(text, status, requestId);
}
