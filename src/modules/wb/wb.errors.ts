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

/**
 * 429 — лимит запросов метода (у `/ping` — 3 запроса за 30 секунд на хост, у
 * «Статистики» — 1 в минуту, а у Базового токена — 1 в 3 часа). WB ответил, просто
 * не сейчас, — «не отвечает» здесь ложь (TASK-197).
 */
export class WbRateLimitError extends WbApiError {
  public get retryable(): boolean {
    return true;
  }

  public get userMessage(): string {
    return `Wildberries ограничил частоту запросов к этим данным. Попробуйте ${waitText(this.retryAfterMs)}.`;
  }
}

/** Пауза из заголовка WB — словами; без заголовка — «через несколько минут». */
function waitText(ms: number | undefined): string {
  if (!ms) return 'через несколько минут';
  const minutes = Math.ceil(ms / 60_000);
  return minutes < 60 ? `через ${minutes} мин` : `через ${Math.ceil(minutes / 60)} ч`;
}

/**
 * 400/404/405/410 или «deprecated» в тексте любого 4xx — WB отверг сам запрос: метод
 * отключён (`supplier/stocks` отвечал «This method is deprecated», TASK-197) или тело не
 * то. Повтор бессмысленен, ошибка наша и уходит админам через ErrorReporter — продавцу
 * честно «мы уже знаем». Образец — `OzonRequestError` (TASK-196).
 */
export class WbRequestError extends WbApiError {
  /** Метод снят: 404/410 или «deprecated»/«obsolete» в тексте. */
  public get obsolete(): boolean {
    return this.status === 404 || this.status === 410 || /deprecated|obsolete/i.test(this.message);
  }

  public get userMessage(): string {
    return this.obsolete
      ? 'Wildberries отключил метод API, которым бот читает эти данные. ' +
          'Это ошибка на нашей стороне — мы уже знаем и исправляем.'
      : 'Wildberries отклонил запрос бота. Это ошибка на нашей стороне — мы уже знаем и исправляем.';
  }
}

const WB_REQUEST_ERROR_STATUSES = new Set([400, 404, 405, 410]);

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
  if (WB_REQUEST_ERROR_STATUSES.has(status) || (status < 500 && /deprecated/i.test(text))) {
    return new WbRequestError(text, status, requestId);
  }
  return new WbApiError(text, status, requestId);
}
