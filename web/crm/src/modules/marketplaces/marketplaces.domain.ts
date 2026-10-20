import type { MarketplaceKey } from '@/navigation';

/** Итог проверки ключа площадкой; `none` — площадку не подключали. */
export type ConnectionStatus = 'none' | 'unverified' | 'ok' | 'rejected' | 'unavailable' | 'empty';

/** Площадка продавца из `GET /api/crm/marketplaces` — без кредов и id. */
export interface MarketplaceConnectionResponse {
  key: string;
  label: string;
  connected: boolean;
  status: string;
  accountCount: number;
  available: boolean;
}

export interface MarketplacesResponse {
  marketplaces: MarketplaceConnectionResponse[];
}

export interface MarketplaceConnection {
  key: MarketplaceKey;
  label: string;
  connected: boolean;
  status: ConnectionStatus;
  accountCount: number;
  /** Площадку можно подключить или она уже работает — решает сервер (фича площадки). */
  available: boolean;
}

/** Ключ Ozon Seller API из формы подключения. */
export interface OzonCredentialsInput {
  clientId: string;
  apiKey: string;
}

/** Ответ `PUT /api/crm/ozon/connection` — вид площадки, без ключа. */
export interface OzonConnectionResponse {
  connection: MarketplaceConnectionResponse;
}

/** Поле формы подключения Ozon, под которое сервер ставит ошибку. */
export type OzonCredentialsField = keyof OzonCredentialsInput;

/** Отказы по самому ключу — встают под поле; остальное (Ozon недоступен) — тостом. */
export const OZON_FIELD_CODES: ReadonlySet<string> = new Set([
  'INVALID_OZON_KEY',
  'OZON_KEY_REJECTED',
  'OZON_KEY_EMPTY',
]);

/** Подпись статуса подключения для карточки. */
export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  none: 'не подключён',
  unverified: 'не проверен',
  ok: 'подключён',
  rejected: 'ключ отвергнут',
  unavailable: 'площадка не ответила',
  empty: 'у ключа нет прав',
};

/** Маршрут «Подключений» (TASK-161) — ключи всех площадок одним экраном. */
export const CONNECTIONS_ROUTE_NAME = 'connections';

/** Карточка площадки из `GET /api/crm/connections` — маска вместо ключа, без id кабинетов. */
export interface ConnectionCardResponse extends MarketplaceConnectionResponse {
  keyHint: string | null;
  checkedAt: string | null;
  checkError: string | null;
  accounts: string[];
}

export interface ConnectionCardsResponse {
  connections: ConnectionCardResponse[];
}

export interface ConnectionCard extends MarketplaceConnection {
  /** «••••a1b2»; null — ключа нет. */
  keyHint: string | null;
  /** null — ключ не проверялся из CRM (ЯМ, подключённый в боте). */
  checkedAt: Date | null;
  /** Что сказала площадка при последнем отказе. */
  checkError: string | null;
  /** Магазины или кабинеты, которые открывает ключ, подписями. */
  accounts: string[];
}

/** Итог «Проверить связь»; `unavailable` — площадка не ответила, о ключе это ничего не говорит. */
export type ConnectionCheckStatus = 'ok' | 'rejected' | 'empty' | 'unavailable';

export interface ConnectionCheck {
  status: ConnectionCheckStatus;
  message: string;
}

export interface ConnectionCheckResponse {
  connection: ConnectionCardResponse;
  check: { status: string; message: string };
}

export interface ConnectionCheckResult {
  connection: ConnectionCard | null;
  check: ConnectionCheck;
}

/** Ответ `PUT /api/crm/ym/stores/token` — нужен только активный магазин бота. */
export interface TokenReplacedResponse {
  stores: unknown[];
  /** Магазин, ставший активным в боте, — только если прежний новому токену недоступен. */
  botStore: string | null;
}

export interface TokenReplaced {
  storeCount: number;
  botStore: string | null;
}

/** Коды отказа по токену WB: встают под поле; «WB недоступен» — тостом. */
export const WB_FIELD_CODES: ReadonlySet<string> = new Set([
  'INVALID_WB_TOKEN',
  'WB_TOKEN_REJECTED',
  'WB_TOKEN_SCOPES',
]);

/** Коды отказа по токену ЯМ: ошибка встаёт под поле, прежний токен остаётся. */
export const TOKEN_FIELD_CODES: ReadonlySet<string> = new Set([
  'TOKEN_REJECTED',
  'INVALID_TOKEN',
  'TOKEN_EMPTY',
]);

/** Цвет бейджа статуса: отказ — сбой, «не ответила»/«не проверен» — нужен взгляд, «нет» — нейтрально. */
export const CONNECTION_STATUS_VARIANT: Record<
  ConnectionStatus,
  'ok' | 'warn' | 'danger' | 'default'
> = {
  none: 'default',
  unverified: 'warn',
  ok: 'ok',
  rejected: 'danger',
  unavailable: 'warn',
  empty: 'danger',
};
