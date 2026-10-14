/**
 * Доменные ошибки Polza.ai — по образцу YandexApiError.
 *
 * Класс выбирает КОД ОТВЕТА, и он же решает, повторять ли запрос. Polza
 * сбойные запросы не тарифицирует, но ключа идемпотентности у неё нет: повтор
 * запроса, который на самом деле дошёл и отработал, — это второй оплаченный
 * ответ. Поэтому retryable только то, что документация прямо велит повторить.
 *
 * Тело ответа целиком НЕ хранится: в `error.metadata.raw` лежит сырой ответ
 * провайдера модели, он бывает большим и ничего не добавляет к коду и trace_id.
 */

export class PolzaApiError extends Error {
  constructor(
    message: string,
    /** HTTP-код ответа. 0 — ответа не было вовсе. */
    public readonly status: number,
    /** Код из тела: `INSUFFICIENT_BALANCE`, `TOO_MANY_REQUESTS`… */
    public readonly code?: string,
    /** trace_id Polza — по нему поддержка находит запрос. */
    public readonly traceId?: string,
    /** Сколько ждать перед повтором, если сервер прислал Retry-After. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }

  /** Запрос, на котором сломалось: `POST /v1/chat/completions`. */
  public request?: string;

  /** Проставляет запрос и возвращает саму ошибку — паттерн YandexApiError.withRequest. */
  public withRequest(method: string | undefined, url: string | undefined): this {
    const parts = [method?.toUpperCase(), url].filter(Boolean);
    if (parts.length) this.request = parts.join(' ');
    return this;
  }

  /** Имеет ли смысл повторить запрос. */
  public get retryable(): boolean {
    return false;
  }

  /** Текст для пользователя — без внутренностей и без ключа. */
  public get userMessage(): string {
    return 'ИИ сейчас недоступен. Попробуйте позже.';
  }
}

/** Ключ не задан — ИИ выключен на сервере. До HTTP дело не доходит. */
export class PolzaDisabledError extends PolzaApiError {
  constructor() {
    super('ИИ выключен: POLZA_AI_TOKEN не задан', 0, 'AI_DISABLED');
  }
}

/** 401 — ключ неверен или отозван. */
export class PolzaAuthError extends PolzaApiError {}

/** 402 — на балансе нет денег или исчерпан лимит ключа. Повтор бессмысленен. */
export class PolzaInsufficientFundsError extends PolzaApiError {}

/** 403 — у ключа нет прав или запрос отклонён модерацией. */
export class PolzaModerationError extends PolzaApiError {}

/** 429 — слишком много запросов. Документация: «повторите позже». */
export class PolzaRateLimitError extends PolzaApiError {
  public get retryable(): boolean {
    return true;
  }
}

/** 408/502/503 — таймаут ожидания, сбой провайдера, временная недоступность. */
export class PolzaServerError extends PolzaApiError {
  public get retryable(): boolean {
    return true;
  }
}

/**
 * Ответа не было: таймаут, обрыв, DNS. НЕ повторяется: запрос мог дойти и
 * отработать — а это оплаченный ответ, второй такой же стоит денег. Таймаут
 * в 620 с тем более: повтор ещё на десять минут держит воркер.
 */
export class PolzaNetworkError extends PolzaApiError {
  constructor(message: string) {
    super(message, 0);
  }
}

/** Статусы, которые документация велит повторить (кроме 429 — у него свой класс). */
const RETRYABLE_SERVER_STATUSES = new Set([408, 502, 503]);

export function toPolzaApiError(
  status: number | undefined,
  payload: unknown,
  retryAfterHeader: unknown,
  fallbackMessage: string,
): PolzaApiError {
  if (!status) return new PolzaNetworkError(fallbackMessage);

  const { message, code, traceId } = extractError(payload);
  const text = message ?? fallbackMessage;
  const retryAfterMs = parseRetryAfter(retryAfterHeader);

  switch (status) {
    case 401:
      return new PolzaAuthError(text, status, code, traceId);
    case 402:
      return new PolzaInsufficientFundsError(text, status, code, traceId);
    case 403:
      return new PolzaModerationError(text, status, code, traceId);
    case 429:
      return new PolzaRateLimitError(text, status, code, traceId, retryAfterMs);
  }
  if (RETRYABLE_SERVER_STATUSES.has(status)) {
    return new PolzaServerError(text, status, code, traceId, retryAfterMs);
  }
  // 400/404/409/413 — запрос составлен неверно; 500 — «обратитесь к поставщику».
  return new PolzaApiError(text, status, code, traceId);
}

interface IErrorFields {
  code?: unknown;
  message?: unknown;
  trace_id?: unknown;
}

/**
 * Документация: `{ error: { code, message, trace_id? }, trace_id }` —
 * вложенно. Плоский вариант `{ code, message, trace_id }` тоже читаем: прокси
 * и старые ответы встречаются, а потерять код дороже лишней ветки.
 */
function extractError(payload: unknown): { message?: string; code?: string; traceId?: string } {
  const body = (payload ?? {}) as IErrorFields & { error?: IErrorFields | string };
  const nested = typeof body.error === 'object' && body.error ? body.error : {};
  const pick = (...values: unknown[]) =>
    values.find((v): v is string => typeof v === 'string' && v.length > 0);

  return {
    message: pick(
      nested.message,
      typeof body.error === 'string' ? body.error : undefined,
      body.message,
    ),
    code: pick(nested.code, body.code),
    traceId: pick(nested.trace_id, body.trace_id),
  };
}

/** Retry-After — секунды или HTTP-дата. Нечитаемое — как отсутствующее. */
export function parseRetryAfter(header: unknown, now: number = Date.now()): number | undefined {
  if (header === undefined || header === null || header === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const at = Date.parse(String(header));
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}
