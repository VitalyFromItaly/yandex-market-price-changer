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

// --- пофичный доступ ---------------------------------------------------------

/** Одна возможность бота — то, что отдаёт GET /api/access/features. */
export interface IFeature {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

/** Пользователь с разрешёнными значениями всех флагов. */
export interface IUserRow {
  telegramUserId: string;
  botId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  status: string;
  storeName?: string;
  configured: boolean;
  features: Record<string, boolean>;
  createdAt?: string;
}

/**
 * Реестр возможностей приходит с сервера, а не описан здесь константой:
 * вторая копия подписей неминуемо разъедется с той, что видит пользователь
 * в боте.
 */
export async function fetchFeatures(token: string): Promise<IFeature[]> {
  const { items } = await request<{ items: IFeature[] }>('/api/access/features', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return items;
}

export async function fetchUsers(token: string): Promise<IUserRow[]> {
  const { items } = await request<{ total: number; items: IUserRow[] }>('/api/access/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return items;
}

/** Один продавец — для его карточки, чтобы не тянуть весь список ради строки. */
export async function fetchUser(
  token: string,
  botId: string,
  telegramUserId: string,
): Promise<IUserRow> {
  const query = `?botId=${encodeURIComponent(botId)}`;
  return await request<IUserRow>(
    `/api/access/users/${encodeURIComponent(telegramUserId)}${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

/**
 * Все правки возвращают обновлённую строку.
 *
 * Экран берёт состояние с сервера, а не собирает его сам: запрос может не
 * пройти, и угаданное состояние уверенно врало бы о том, что доступ закрыт,
 * пока он открыт.
 */
export async function setUserFeature(
  token: string,
  user: IUserRow,
  feature: string,
  enabled: boolean,
): Promise<IUserRow> {
  return await patchUser(token, user, 'features', { feature, enabled });
}

export async function setUserApproved(
  token: string,
  user: IUserRow,
  approved: boolean,
): Promise<IUserRow> {
  return await patchUser(token, user, 'status', { approved });
}

function patchUser(
  token: string,
  user: IUserRow,
  path: 'features' | 'status',
  body: Record<string, unknown>,
): Promise<IUserRow> {
  return request<IUserRow>(`/api/access/users/${encodeURIComponent(user.telegramUserId)}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ botId: user.botId, ...body }),
  });
}

/**
 * Полностью удалить продавца. Строку возвращать нечего — сервер отвечает
 * `{ ok: true }`. `botId` — query-параметром, как у fetchUser: у DELETE тела нет.
 */
export async function deleteUser(token: string, user: IUserRow): Promise<void> {
  const query = `?botId=${encodeURIComponent(user.botId)}`;
  await request<{ ok: boolean }>(
    `/api/access/users/${encodeURIComponent(user.telegramUserId)}${query}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
}
