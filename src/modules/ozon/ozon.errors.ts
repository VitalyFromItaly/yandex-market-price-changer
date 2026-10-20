/**
 * Доменные ошибки Ozon Seller API — по образцу YandexApiError и PolzaApiError.
 *
 * Класс выбирает КОД ОТВЕТА, и он же решает, повторять ли запрос. В отличие от
 * Polza, повторяется и сетевой сбой — но только на ЧИТАЮЩИХ вызовах (`call()`):
 * второй такой же запрос ничего не стоит и ничего не меняет у продавца. Запись
 * остатков (TASK-175) идёт через `callWrite()` без повторов, как `postWrite` ЯМ.
 *
 * Тело ответа Ozon — `{code: число, message, details}` (проверено живым
 * запросом 16-10-2026: неверный ключ — 401 `{"code":16, "message":"Invalid
 * Api-Key, please check the key and try again"}`, нечисловой Client-Id — 400
 * code 3). Хранятся только код и текст: ключа в них нет.
 */

export class OzonApiError extends Error {
  constructor(
    message: string,
    /** HTTP-код ответа. 0 — ответа не было вовсе. */
    public readonly status: number,
    /** Код из тела (`16`, `3`…), строкой. */
    public readonly code?: string,
    /** Сколько ждать перед повтором, если сервер прислал Retry-After. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }

  /** Запрос, на котором сломалось: `POST /v1/roles`. */
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

  /** Текст для продавца — без внутренностей и без ключа. */
  public get userMessage(): string {
    return 'Ozon сейчас не отвечает. Попробуйте позже.';
  }
}

/** 401/403 — ключ неверен, отозван или не подходит к Client-Id. Повтор бессмысленен. */
export class OzonAuthError extends OzonApiError {
  public get userMessage(): string {
    return (
      'Ozon не принял ключ. Проверьте Client-Id и Api-Key в личном кабинете Ozon ' +
      '(Настройки → Seller API): ключ должен быть действующим и выпущенным для этого Client-Id.'
    );
  }
}

/** 429 — превышен лимит запросов метода для Client-Id. */
export class OzonRateLimitError extends OzonApiError {
  public get retryable(): boolean {
    return true;
  }
}

/** 5xx — сбой на стороне Ozon. */
export class OzonServerError extends OzonApiError {
  public get retryable(): boolean {
    return true;
  }
}

/** Ответа не было: таймаут, обрыв, DNS. Повторяется — запрос читающий. */
export class OzonNetworkError extends OzonApiError {
  constructor(message: string) {
    super(message, 0);
  }

  public get retryable(): boolean {
    return true;
  }
}

export function toOzonApiError(
  status: number | undefined,
  payload: unknown,
  retryAfterHeader: unknown,
  fallbackMessage: string,
): OzonApiError {
  if (!status) return new OzonNetworkError(fallbackMessage);

  const { message, code } = extractError(payload);
  const text = message ?? fallbackMessage;

  if (status === 401 || status === 403) return new OzonAuthError(text, status, code);
  if (status === 429) {
    return new OzonRateLimitError(text, status, code, parseRetryAfter(retryAfterHeader));
  }
  if (status >= 500) {
    return new OzonServerError(text, status, code, parseRetryAfter(retryAfterHeader));
  }
  // 400/404 — запрос составлен неверно.
  return new OzonApiError(text, status, code);
}

function extractError(payload: unknown): { message?: string; code?: string } {
  const body = (payload ?? {}) as { code?: unknown; message?: unknown };
  const message =
    typeof body.message === 'string' && body.message.length > 0 ? body.message : undefined;
  const code =
    typeof body.code === 'number' || (typeof body.code === 'string' && body.code.length > 0)
      ? String(body.code)
      : undefined;
  return { message, code };
}

/** Retry-After — секунды или HTTP-дата. Нечитаемое — как отсутствующее. */
export function parseRetryAfter(header: unknown, now: number = Date.now()): number | undefined {
  if (header === undefined || header === null || header === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const at = Date.parse(String(header));
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}
