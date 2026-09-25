import type { IStoreEntry } from '../../../database/schemas/yandex-market.schema';
import type { TFeatureMap } from '../../telegram/bots/shared/features.domain';

import { storeLabel, uniqueLabels } from '../../telegram/bots/price-changer-bot/store-picker';
import { storeKeyOf } from '../../yandex/stores/stores.domain';
import { visibleSections } from '../crm-features.domain';

/** 404: ключа нет в списке магазинов токена (ссылка устарела или чужая). */
export const STORE_NOT_FOUND = 'STORE_NOT_FOUND';
export const STORE_NOT_FOUND_TEXT =
  'Магазин не найден среди магазинов вашего токена — откройте его заново из списка «Магазины».';

/** 400: Маркет отклонил новый токен. Прежний остаётся. */
export const TOKEN_REJECTED = 'TOKEN_REJECTED';
/** 400: токен не похож на токен (проверка бота `validateStep('token')`). */
export const INVALID_TOKEN = 'INVALID_TOKEN';
/** 400: токен принят, но не открывает ни одного магазина. */
export const TOKEN_EMPTY = 'TOKEN_EMPTY';
export const TOKEN_EMPTY_TEXT =
  'По этому токену Маркет не вернул ни одного магазина. Прежний токен остался в силе.';
/** 503: Маркет недоступен — проверить токен нечем. */
export const MARKET_UNAVAILABLE = 'MARKET_UNAVAILABLE';
export const MARKET_UNAVAILABLE_TEXT =
  'Не удалось проверить токен: Яндекс.Маркет не отвечает. Прежний токен остался в силе — попробуйте позже.';

/**
 * Строка списка магазинов. Собирается перечислением полей: ни campaign_id, ни
 * business_id, ни токена (довод `/auth/me`). Магазин адресуется `key`.
 */
export interface ICrmStoreItem {
  key: string;
  /** Имя с моделью — та же подпись, что на кнопке пикера бота. */
  label: string;
  businessName: string;
  placementType: string | null;
}

export interface ICrmStoresView {
  stores: ICrmStoreItem[];
}

/** Магазин, в который провалились: подпись и разделы по ЕГО модели. */
export interface ICrmStoreView extends ICrmStoreItem {
  sections: string[];
}

export interface ICrmTokenReplaced extends ICrmStoresView {
  /**
   * Подпись магазина, который стал активным в БОТЕ, — только если прежний
   * новому токену недоступен. null — в боте ничего не поменялось.
   */
  botStore: string | null;
}

/**
 * Подписи в пределах списка различаются (`uniqueLabels`): у одного продавца две
 * кампании «Время с SBrand» — FBS и FBY, и без модели и нумерации выбор
 * превратился бы в лотерею.
 */
export function toStoreItems(entries: readonly IStoreEntry[]): ICrmStoreItem[] {
  const labels = uniqueLabels(entries.map((entry) => storeLabel(entry)));
  return entries.map((entry, index) => ({
    key: storeKeyOf(entry.campaignId),
    label: labels[index],
    businessName: entry.businessName ?? '',
    placementType: entry.placementType ?? null,
  }));
}

export function toStoreView(
  entries: readonly IStoreEntry[],
  entry: IStoreEntry,
  features: TFeatureMap,
): ICrmStoreView {
  const key = storeKeyOf(entry.campaignId);
  const item = toStoreItems(entries).find((candidate) => candidate.key === key);
  return {
    key,
    label: item?.label ?? storeLabel(entry),
    businessName: entry.businessName ?? '',
    placementType: entry.placementType ?? null,
    sections: visibleSections(features, entry.placementType, 'store'),
  };
}

export function parseTokenBody(body: unknown): string {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  return typeof raw.token === 'string' ? raw.token.trim() : '';
}
