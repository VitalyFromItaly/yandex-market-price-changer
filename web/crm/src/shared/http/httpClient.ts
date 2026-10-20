/**
 * Единственный HTTP-клиент CRM. Все запросы — к /api/crm (бэкенд CRM), с
 * `Authorization: Bearer`. Токен и реакцию на 401 даёт модуль auth через
 * setTokenProvider / onUnauthorized — shared не знает о сторах.
 */
const API_PREFIX = '/api/crm';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Машинный код сервера (`PASSWORD_CHANGE_REQUIRED`), если он его прислал. */
    readonly code: string | null = null,
    /** Какое поле формы не принято (`taxPercent`, `brandDiscounts.casio`), если сервер сказал. */
    readonly field: string | null = null,
    /** Тело ошибки целиком — для кодов с данными (`UPLOAD_RUNNING` несёт `jobId`). */
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Сеть недоступна или сервер не ответил — статуса нет. */
export const NETWORK_ERROR_STATUS = 0;

let tokenProvider: () => string | null = () => null;
let unauthorizedHandler: ((error: ApiError) => void) | null = null;

export function setTokenProvider(provider: () => string | null): void {
  tokenProvider = provider;
}

export function onUnauthorized(handler: ((error: ApiError) => void) | null): void {
  unauthorizedHandler = handler;
}

interface NestErrorBody {
  message?: string | string[];
  code?: string;
  field?: string;
}

/** Nest отдаёт message строкой или массивом (валидация) — показываем человеку первую строку. */
function messageOf(body: NestErrorBody | null, status: number): string {
  const raw = body?.message;
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text === 'string' && text.length > 0) return text;
  return status >= 500
    ? 'Сервер не ответил как положено. Попробуйте ещё раз.'
    : `Ошибка запроса (${status})`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function bodyOf(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (body instanceof FormData) return body;
  return JSON.stringify(body);
}

/**
 * Общий путь всех запросов: заголовки, сетевой сбой, разбор ошибки и 401.
 * Отдаёт ответ только когда он `ok` — тело разбирает вызывающий (JSON или файл).
 */
async function send(
  method: string,
  path: string,
  body: unknown,
  accept: string,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept };
  const token = tokenProvider();
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  // FormData уходит как есть: Content-Type с boundary ставит сам браузер.
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers,
      body: bodyOf(body),
    });
  } catch {
    throw new ApiError(
      'Нет связи с сервером. Проверьте интернет и повторите.',
      NETWORK_ERROR_STATUS,
    );
  }
  if (response.ok) return response;

  const errorBody = ((await readJson(response)) ?? null) as NestErrorBody | null;
  const error = new ApiError(
    messageOf(errorBody, response.status),
    response.status,
    errorBody?.code ?? null,
    typeof errorBody?.field === 'string' ? errorBody.field : null,
    errorBody as Record<string, unknown> | null,
  );
  if (response.status === 401 && unauthorizedHandler !== null) unauthorizedHandler(error);
  throw error;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body, 'application/json');
  return (await readJson(response)) as T;
}

export interface DownloadedFile {
  blob: Blob;
  /** Имя из Content-Disposition (`filename*` в UTF-8 важнее ASCII-запасного). */
  filename: string | null;
}

/** Имя файла из Content-Disposition: сперва RFC 5987 `filename*`, затем обычное. */
export function filenameOf(disposition: string | null): string | null {
  if (disposition === null) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (extended?.[1] !== undefined) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Битая кодировка — падаем на ASCII-имя ниже.
    }
  }
  const plain = /filename="([^"]*)"/i.exec(disposition);
  return plain?.[1] ?? null;
}

/** Файл (xlsx отчёта) тем же путём авторизации и ошибок, что и JSON. */
export async function requestFile(path: string): Promise<DownloadedFile> {
  const response = await send('GET', path, undefined, '*/*');
  return {
    blob: await response.blob(),
    filename: filenameOf(response.headers.get('Content-Disposition')),
  };
}

export const http = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body),
  delete: <T>(path: string): Promise<T> => request<T>('DELETE', path),
  file: (path: string): Promise<DownloadedFile> => requestFile(path),
  /** multipart (загрузка файла) — тем же путём авторизации, 401 и ApiError. */
  upload: <T>(path: string, form: FormData): Promise<T> => request<T>('POST', path, form),
};
