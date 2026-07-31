/** Одна запись журнала — то, что отдаёт GET /api/logs. */
export interface IActionLogRow {
  _id: string;
  telegramUserId: string;
  username?: string;
  name?: string;
  botId: string;
  chatId?: string;
  direction: string;
  kind: string;
  action: string;
  status: string;
  durationMs?: number;
  error?: string;
  source?: string;
  errorType?: string;
  stack?: string;
  httpStatus?: number;
  requestUrl?: string;
  context?: string;
  createdAt: string;
}

export interface ILogsResponse {
  total: number;
  limit: number;
  skip: number;
  items: IActionLogRow[];
}

export interface ILogsQuery {
  telegramUserId?: string;
  kind?: string;
  direction?: string;
  status?: string;
  source?: string;
  since?: string;
  until?: string;
  limit?: number;
  skip?: number;
}

/**
 * Отдельный класс ошибки, а не строка.
 *
 * 401 отличается от «сеть отвалилась» тем, что требует другого действия: в
 * первом случае надо войти заново, во втором — просто повторить. Пока обе
 * ситуации выглядели одинаково, панель на каждый сетевой сбой выкидывала на
 * форму входа.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * Ключ хранилища. sessionStorage, а НЕ localStorage: токен даёт доступ к
 * действиям и сообщениям пользователей, и переживать закрытие вкладки он не
 * должен. Цена — повторный вход раз в сессию, что для админской панели
 * приемлемо.
 */
const STORAGE_KEY = 'action-log-token';

export function loadToken(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

export function saveToken(token: string): void {
  sessionStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Собирает query, выбрасывая пустые значения: `?kind=` фильтрует по пустой строке. */
function queryString(query: ILogsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    // fetch отклоняется только на сетевом сбое; HTTP-ошибка сюда не попадает.
    throw new ApiError(`Сервер недоступен: ${(error as Error).message}`, 0);
  }

  if (!response.ok) throw new ApiError(await messageOf(response), response.status);

  return (await response.json()) as T;
}

/** Nest отдаёт ошибки как {message}. На ошибке прокси прилетит HTML — не падаем. */
async function messageOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    return message || `Ошибка ${response.status}`;
  } catch {
    return `Ошибка ${response.status}`;
  }
}

export async function login(loginId: string, password: string): Promise<string> {
  const { token } = await request<{ token: string }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginId, password }),
  });
  return token;
}

/** Жив ли токен. Панель спрашивает при загрузке, чтобы не показывать пустую таблицу. */
export async function me(token: string): Promise<string> {
  const { adminId } = await request<{ adminId: string }>('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return adminId;
}

export async function fetchLogs(token: string, query: ILogsQuery): Promise<ILogsResponse> {
  return await request<ILogsResponse>(`/api/logs${queryString(query)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
