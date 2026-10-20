import type {
  IConnectionAccount,
  TConnectionStatus,
} from '../../database/schemas/marketplace-connection.schema';
import type { IMarketplaceConnectionRow } from '../../database/services/marketplace-connection.service';
import type { TMarketplace } from '../../shared/marketplace';

import { MARKETPLACE_LABEL, MARKETPLACES } from '../../shared/marketplace';
import { storeLabel } from '../telegram/bots/price-changer-bot/store-picker';
import {
  FEATURE,
  type TFeatureKey,
  type TFeatureMap,
  isFeatureEnabled,
} from '../telegram/bots/shared/features.domain';

/**
 * Фича, без которой площадку нельзя подключить (new_functions_behind_feature).
 * ЯМ — без фичи: это основная площадка бота. Нет строки — площадка закрыта.
 */
const MARKETPLACE_FEATURE: Partial<Record<TMarketplace, TFeatureKey>> = {
  ozon: FEATURE.OZON,
  wb: FEATURE.WB,
};

/** Фича площадки, без которой её нельзя ни подключить, ни проверить; у ЯМ — нет (пустой список). */
export function marketplaceFeatures(marketplace: TMarketplace): TFeatureKey[] {
  const feature = MARKETPLACE_FEATURE[marketplace];
  return feature ? [feature] : [];
}

/**
 * Открыта ли продавцу площадка: фича площадки (у ЯМ её нет — открыт всегда).
 * Одно правило для финансов CRM, «Склада» и уведомлений.
 */
export function isMarketplaceFeatureOpen(
  features: Readonly<Record<string, boolean>>,
  marketplace: TMarketplace,
): boolean {
  return marketplaceFeatures(marketplace).every((feature) => features[feature] === true);
}

/**
 * Какие площадки продавцу «доступны» (не «скоро»): адаптер уже есть, либо
 * ключ можно подключить — но в обоих случаях только при открытой фиче
 * площадки. Закрытая фича = «скоро», как закрытый раздел = нет раздела:
 * иначе «Обзор» звал бы «подключить» туда, где гейт ответит 403.
 */
export function availableMarketplaces(
  supported: readonly TMarketplace[],
  connectable: readonly TMarketplace[],
  features: TFeatureMap,
): TMarketplace[] {
  return MARKETPLACES.filter((key) => {
    if (!supported.includes(key) && !connectable.includes(key)) return false;
    if (key === 'ym') return true;
    const feature = MARKETPLACE_FEATURE[key];
    return feature !== undefined && isFeatureEnabled(features, feature);
  });
}

/**
 * Площадка продавца в ответах наружу (CRM). Ни кредов, ни id кабинетов —
 * только то, что показывается: подпись, подключена ли, итог проверки и
 * сколько магазинов открыл ключ.
 *
 * `status: 'none'` — площадка не подключалась вовсе; отличается от
 * `rejected`/`unavailable`, где подключение есть, но ключ не работает.
 */
export interface IMarketplaceConnectionView {
  key: TMarketplace;
  label: string;
  connected: boolean;
  status: TConnectionStatus | 'none';
  accountCount: number;
  /** Площадку можно подключить или она уже работает — иначе «скоро» (`availableMarketplaces`). */
  available: boolean;
}

/** Подключение ЯМ в той форме, в какой его знает `YandexMarket`. */
export interface IYmConnectionSource {
  token?: string;
  campaign_id?: string;
  business_id?: string;
  stores?: unknown[];
}

/**
 * Все три площадки по порядку `MARKETPLACES`, ЯМ — из `YandexMarket`
 * (решение `marketplace_connection_ym_virtual`), Ozon/WB — из коллекции
 * подключений. Ответ собирается перечислением полей: ни одна строка-источник
 * не раскладывается целиком, поэтому ключ в ответ не попадёт и тогда, когда
 * источник его несёт.
 */
export function connectionsView(
  ym: IYmConnectionSource | null,
  rows: readonly IMarketplaceConnectionRow[],
  available: readonly TMarketplace[],
): IMarketplaceConnectionView[] {
  return MARKETPLACES.map((key) => {
    const isAvailable = available.includes(key);
    if (key === 'ym') {
      const connected = !!(ym?.token && ym.campaign_id && ym.business_id);
      return {
        key,
        label: MARKETPLACE_LABEL[key],
        connected,
        // Ключ ЯМ проверяется при вводе (онбординг, смена токена в CRM), а
        // не хранимым статусом: записанный токен — проверенный токен.
        status: connected ? 'ok' : 'none',
        accountCount: connected ? Math.max(ym.stores?.length ?? 0, 1) : 0,
        available: isAvailable,
      };
    }
    const row = rows.find((candidate) => candidate.marketplace === key);
    return {
      key,
      label: MARKETPLACE_LABEL[key],
      connected: row?.status === 'ok',
      status: row ? row.status : 'none',
      accountCount: row?.accounts.length ?? 0,
      available: isAvailable,
    };
  });
}

/** Сколько последних символов ключа видно на «Подключениях». */
const KEY_HINT_TAIL = 4;
/** Короче — хвост ключа был бы заметной его частью, поэтому показываем одни точки. */
const KEY_HINT_MIN_LENGTH = 12;
const KEY_HINT_DOTS = '••••';

/**
 * Маска ключа для экрана: «••••a1b2». Продавцу этого хватает, чтобы узнать,
 * какой из его ключей стоит, а ключ целиком из ответа не восстановить. Нет
 * ключа — null (не «••••»: точки читались бы как «что-то записано»).
 */
export function maskKeyHint(key: string | null | undefined): string | null {
  const value = typeof key === 'string' ? key.trim() : '';
  if (!value) return null;
  if (value.length < KEY_HINT_MIN_LENGTH) return KEY_HINT_DOTS;
  return `${KEY_HINT_DOTS}${value.slice(-KEY_HINT_TAIL)}`;
}

/**
 * Карточка площадки на «Подключениях» (TASK-161) — то же, что строка
 * `connectionsView`, плюс то, что нужно, чтобы решить «менять ли ключ»: маска,
 * когда ключ последний раз подтвердила площадка, что она сказала при отказе и
 * какие магазины/кабинеты он открывает. Ключа нет ни в одном поле.
 */
export interface IConnectionCard extends IMarketplaceConnectionView {
  keyHint: string | null;
  /** ISO; null — не проверялся из CRM (ЯМ, подключённый в боте). */
  checkedAt: string | null;
  checkError: string | null;
  accounts: string[];
}

/** Ozon/WB: строка подключения и её секрет (только ради маски). */
export interface IStoredConnectionSource {
  row: IMarketplaceConnectionRow;
  secret: string | null;
}

export interface IYmCardSource extends IYmConnectionSource {
  tokenCheckedAt?: Date | null;
  stores?: Array<{ storeName: string; placementType?: string }>;
}

/**
 * Карточки по порядку `MARKETPLACES`. Статус и «подключено» — из
 * `connectionsView`, чтобы карточка и переключатель площадок не расходились.
 */
export function connectionCards(
  ym: IYmCardSource | null,
  stored: readonly IStoredConnectionSource[],
  available: readonly TMarketplace[],
): IConnectionCard[] {
  const views = connectionsView(
    ym,
    stored.map((source) => source.row),
    available,
  );
  return views.map((view) => {
    if (view.key === 'ym') {
      return {
        ...view,
        keyHint: view.connected ? maskKeyHint(ym?.token) : null,
        checkedAt: ym?.tokenCheckedAt ? new Date(ym.tokenCheckedAt).toISOString() : null,
        checkError: null,
        accounts: view.connected ? ymStoreNames(ym) : [],
      };
    }
    const source = stored.find((candidate) => candidate.row.marketplace === view.key);
    return {
      ...view,
      keyHint: maskKeyHint(source?.secret),
      checkedAt: source?.row.checkedAt ? new Date(source.row.checkedAt).toISOString() : null,
      checkError: source?.row.checkError ?? null,
      accounts: (source?.row.accounts ?? []).map(accountLabel),
    };
  });
}

/** Магазины ЯМ той же подписью, что на «Магазинах» и в пикере бота: «Имя (FBS)». */
function ymStoreNames(ym: IYmCardSource | null): string[] {
  return (ym?.stores ?? []).filter((store) => store.storeName?.trim()).map(storeLabel);
}

/** Кабинет без названия (Ozon его не отдаёт) — без номера: id кабинета экраны не печатают. */
const UNNAMED_ACCOUNT = 'кабинет без названия';

function accountLabel(account: IConnectionAccount): string {
  return account.name.trim() || UNNAMED_ACCOUNT;
}

/**
 * Итог «Проверить связь». `unavailable` — площадка не ответила: о ключе это
 * ничего не говорит, поэтому такой исход не записывается (иначе моргнувшая
 * сеть показала бы рабочее подключение отключённым — довод самопроверки).
 */
export type TConnectionCheckStatus = 'ok' | 'rejected' | 'empty' | 'unavailable';

export interface IConnectionCheck {
  status: TConnectionCheckStatus;
  message: string;
}

/** Тексты исходов проверки без замены ключа — «ключ остался прежним» здесь правда всегда. */
export function connectionCheckText(
  marketplace: TMarketplace,
  status: Exclude<TConnectionCheckStatus, 'rejected'>,
): string {
  const label = MARKETPLACE_LABEL[marketplace];
  switch (status) {
    case 'ok':
      return `Связь с площадкой ${label} есть: ключ принят.`;
    case 'empty':
      return marketplace === 'ym'
        ? 'Маркет принял токен, но не вернул ни одного магазина.'
        : `${label} принял ключ, но читать им нечего — у ключа нет нужных прав.`;
    default:
      return `${label} сейчас не отвечает — связь не проверена. Ключ остался прежним, попробуйте позже.`;
  }
}
