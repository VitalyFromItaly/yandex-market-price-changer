/**
 * Доменные ошибки Partner API.
 *
 * Зачем. Прежний HttpClient сворачивал ответ в
 * `new Error('HTTP Error 401: Unauthorized - {...}')` — строку, из которой
 * вызывающий код не мог узнать ни код ответа, ни то, стоит ли повторять
 * запрос. Отличить «токен протух» от «Яндекс лежит» можно было только
 * регуляркой по тексту. Здесь код сохраняется полем, а тип ошибки говорит,
 * что с ней делать.
 */

export class YandexApiError extends Error {
  constructor(
    message: string,
    /** HTTP-код ответа. 0 означает, что ответа не было вовсе. */
    public readonly status: number,
    /** Тело ответа, как его вернул Яндекс, — для логов. */
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }

  /**
   * Запрос, на котором сломалось: `GET v2/campaigns/123/orders`.
   *
   * Заполняется ПОСЛЕ создания, методом withRequest: фабрика toYandexApiError
   * выбирает класс по коду ответа и про адрес не знает, а знает про него
   * перехватчик в клиенте. Тащить метод и путь через все конструкторы
   * подклассов (у сетевой ошибки сигнатура своя) — дороже, чем одно поле.
   *
   * Без него на вопрос «на каком запросе упало» ответить нечем: раньше адрес
   * попадал только в текст лог-строки и наружу не выходил.
   */
  public request?: string;

  /** Проставляет запрос и возвращает саму ошибку — удобно в `return`. */
  public withRequest(method: string | undefined, url: string | undefined): this {
    const parts = [method?.toUpperCase(), url].filter(Boolean);
    if (parts.length) this.request = parts.join(' ');
    return this;
  }

  /** Имеет ли смысл повторить запрос. */
  public get retryable(): boolean {
    return false;
  }

  /** Текст для пользователя — без внутренностей и без токена. */
  public get userMessage(): string {
    return 'Не удалось получить данные из Яндекс.Маркета. Попробуйте позже.';
  }
}

/** 401/403 — токен неверен, протух или выдан с недостаточным скоупом. */
export class YandexAuthError extends YandexApiError {
  public get userMessage(): string {
    return [
      'Яндекс.Маркет отклонил ваш API-токен.',
      '',
      'Проверьте, что токен не отозван и выдан с доступом',
      '«Обработка заказов и учёт товаров».',
    ].join('\n');
  }
}

/** 404 — кампании с таким id нет или токен не даёт к ней доступа. */
export class YandexNotFoundError extends YandexApiError {
  public get userMessage(): string {
    // Про Campaign ID пользователю говорить нельзя: он его не вводит и нигде
    // не видит — бот определяет магазин по токену (TASK-050/052). Совет
    // «проверьте Campaign ID в настройках» отправлял искать поле, которого на
    // экране настроек нет.
    return 'Магазин недоступен по этому токену. Подключите магазин заново в настройках.';
  }
}

/**
 * 420 и 429 — превышен лимит запросов.
 *
 * 420 у Яндекса означает именно исчерпание квоты метода (у orders — 10 000
 * запросов в час), а не привычный 429; ловим оба.
 */
export class YandexRateLimitError extends YandexApiError {
  public get retryable(): boolean {
    return true;
  }

  public get userMessage(): string {
    return 'Превышен лимит запросов к Яндекс.Маркету. Отчёт будет готов чуть позже.';
  }
}

/** 400/422 — запрос составлен неверно. Повтор не поможет. */
export class YandexBadRequestError extends YandexApiError {
  public get userMessage(): string {
    return 'Яндекс.Маркет отклонил запрос. Проверьте настройки магазина.';
  }
}

/** 5xx — на стороне Яндекса. */
export class YandexServerError extends YandexApiError {
  public get retryable(): boolean {
    return true;
  }

  public get userMessage(): string {
    // Без переопределения 5xx выглядел как общее «не удалось получить данные»,
    // и пользователь шёл проверять свои настройки — там, где виноват не он.
    return 'Яндекс.Маркет отвечает ошибкой. Это на его стороне — попробуйте позже.';
  }
}

/** Ответа не было: таймаут, обрыв соединения, DNS. */
export class YandexNetworkError extends YandexApiError {
  constructor(message: string) {
    super(message, 0);
  }

  public get retryable(): boolean {
    return true;
  }

  public get userMessage(): string {
    return 'Яндекс.Маркет не отвечает. Попробуйте позже.';
  }
}

/**
 * Ошибку выбирает КОД ОТВЕТА, а не текст. Тело Partner API кладёт в
 * `errors: [{code, message}]` — вытаскиваем оттуда сообщение, если оно есть.
 */
export function toYandexApiError(
  status: number | undefined,
  payload: unknown,
  fallbackMessage: string,
): YandexApiError {
  if (!status) return new YandexNetworkError(fallbackMessage);

  const message = extractMessage(payload) ?? fallbackMessage;

  if (status === 401 || status === 403) {
    return new YandexAuthError(message, status, payload);
  }
  if (status === 404) {
    return new YandexNotFoundError(message, status, payload);
  }
  if (status === 420 || status === 429) {
    return new YandexRateLimitError(message, status, payload);
  }
  if (status >= 500) {
    return new YandexServerError(message, status, payload);
  }
  if (status >= 400) {
    return new YandexBadRequestError(message, status, payload);
  }
  return new YandexApiError(message, status, payload);
}

function extractMessage(payload: unknown): string | null {
  const body = payload as { errors?: Array<{ code?: string; message?: string }> };
  const errors = body?.errors;
  if (!Array.isArray(errors) || !errors.length) return null;
  return errors
    .map((e) => [e.code, e.message].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ');
}
