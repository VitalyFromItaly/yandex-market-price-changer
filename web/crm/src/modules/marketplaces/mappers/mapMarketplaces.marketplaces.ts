import type {
  ConnectionCard,
  ConnectionCardsResponse,
  ConnectionCheckResponse,
  ConnectionCheckResult,
  ConnectionCheckStatus,
  ConnectionStatus,
  MarketplaceConnection,
  MarketplacesResponse,
  OzonConnectionResponse,
  TokenReplaced,
  TokenReplacedResponse,
} from '../marketplaces.domain';
import type { MarketplaceKey } from '@/navigation';

import { ALL_MARKETPLACES } from '@/navigation';
import { formatSavedAt } from '@/shared/utils';

const STATUSES: readonly ConnectionStatus[] = [
  'none',
  'unverified',
  'ok',
  'rejected',
  'unavailable',
  'empty',
];

function isKey(value: string): value is MarketplaceKey {
  return ALL_MARKETPLACES.some((m) => m.key === value);
}

/**
 * Ответ → домен. Площадка, которой фронт не знает (сервер новее сборки), не
 * показывается: ей некуда вести. Незнакомый статус — `none`, а не «подключена».
 */
export function mapMarketplaces(response: MarketplacesResponse): MarketplaceConnection[] {
  return response.marketplaces.flatMap((item) => {
    if (!isKey(item.key)) return [];
    const status = STATUSES.find((s) => s === item.status) ?? 'none';
    return [
      {
        key: item.key,
        label: item.label,
        connected: item.connected,
        status,
        accountCount: item.accountCount,
        available: item.available,
      },
    ];
  });
}

/** Ответ подключения Ozon → домен; тот же разбор, что у списка. */
export function mapOzonConnection(response: OzonConnectionResponse): MarketplaceConnection | null {
  return mapMarketplaces({ marketplaces: [response.connection] })[0] ?? null;
}

const CHECK_STATUSES: readonly ConnectionCheckStatus[] = ['ok', 'rejected', 'empty', 'unavailable'];

function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Карточки «Подключений»; та же отбраковка площадок и статусов, что у списка. */
export function mapConnectionCards(response: ConnectionCardsResponse): ConnectionCard[] {
  return response.connections.flatMap((item) => {
    const [base] = mapMarketplaces({ marketplaces: [item] });
    if (base === undefined) return [];
    return [
      {
        ...base,
        keyHint: item.keyHint,
        checkedAt: toDate(item.checkedAt),
        checkError: item.checkError,
        accounts: [...item.accounts],
      },
    ];
  });
}

/**
 * Итог проверки связи. Незнакомый статус — `unavailable`: «не проверено»
 * честнее, чем «связь есть» или «ключ отвергнут».
 */
export function mapConnectionCheck(response: ConnectionCheckResponse): ConnectionCheckResult {
  const status = CHECK_STATUSES.find((s) => s === response.check.status) ?? 'unavailable';
  return {
    connection: mapConnectionCards({ connections: [response.connection] })[0] ?? null,
    check: { status, message: response.check.message },
  };
}

export function mapTokenReplaced(response: TokenReplacedResponse): TokenReplaced {
  return { storeCount: response.stores.length, botStore: response.botStore };
}

/** Текст тоста после смены токена ЯМ: говорит, если в боте сменился активный магазин. */
export function tokenReplacedText(result: TokenReplaced): string {
  return result.botStore === null
    ? 'Список магазинов обновлён.'
    : `Прежний магазин новому токену недоступен — в боте активным стал «${result.botStore}».`;
}

/**
 * Подпись даты проверки на карточке. У ЯМ без даты ключ ставили в боте, и он
 * с тех пор не перепроверялся из CRM — это и пишем, а не «никогда».
 */
export function checkedLabel(card: ConnectionCard, now: Date = new Date()): string | null {
  if (card.checkedAt !== null) {
    const at = formatSavedAt(card.checkedAt.toISOString(), now);
    return at === null ? null : `проверен ${at}`;
  }
  if (!card.connected) return null;
  return card.key === 'ym' ? 'проверен при подключении в боте' : 'ещё не проверялся';
}
