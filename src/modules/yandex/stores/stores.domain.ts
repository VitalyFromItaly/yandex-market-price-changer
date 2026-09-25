import type {
  IStoreEntry,
  YandexMarketDocument,
} from '../../../database/schemas/yandex-market.schema';

import { createHash } from 'crypto';

/**
 * Магазин, выбранный в вебе, — не активный магазин бота.
 *
 * В боте магазин один на продавца (`YandexMarket.campaign_id`) и меняется
 * кнопкой «🏪 Сменить магазин». В CRM магазин — место, куда проваливаются из
 * списка, и открыть два магазина в двух вкладках — нормальный сценарий. Поэтому
 * веб активный магазин НЕ пишет: каждый запрос называет свой, а сервисы отчётов
 * получают документ, в котором идентификаторы кампании перекрыты выбранной.
 */

/**
 * Ключ магазина для URL и ответов CRM: первые 16 hex sha256 от campaignId.
 *
 * campaign_id продавцу не показывается нигде (адресная строка — тоже экран), а
 * индекс в списке сдвинулся бы при обновлении кэша и открыл бы соседний
 * магазин по старой ссылке. Хэш стабилен и ничего не говорит.
 */
export function storeKeyOf(campaignId: string): string {
  return createHash('sha256').update(String(campaignId)).digest('hex').slice(0, 16);
}

/** Запись кэша `stores` по ключу из URL; undefined — токен такого магазина не открывает. */
export function findByKey(
  stores: readonly IStoreEntry[] | undefined | null,
  key: string,
): IStoreEntry | undefined {
  return stores?.find((store) => store?.campaignId && storeKeyOf(store.campaignId) === key);
}

/**
 * Документ магазина, перекрытый выбранной кампанией.
 *
 * Plain-объект, исходный документ не меняется: сохранить такой объект нельзя
 * (у него нет `save`), и это правильно — перекрытие живёт один запрос. Сервисы
 * отчётов читают только поля, поэтому им хватает формы документа; модель
 * размещения (`placementOfCampaign(store.stores, store.campaign_id)`) на
 * перекрытии находит выбранную кампанию сама.
 *
 * Кампания обязана быть в кэше `stores` — список собран по токену продавца,
 * так что это и есть проверка доступа: чужой campaignId не пройдёт.
 */
export function scopeStore(
  doc: YandexMarketDocument,
  campaignId: string,
): YandexMarketDocument | null {
  const entry = doc.stores?.find((store) => store?.campaignId === campaignId);
  if (!entry) return null;

  const plain = (
    typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }
  ) as YandexMarketDocument;

  return {
    ...plain,
    campaign_id: entry.campaignId,
    business_id: entry.businessId,
    name: entry.storeName,
  } as YandexMarketDocument;
}

/**
 * Какая кампания останется активной в боте после смены токена в вебе.
 *
 * Веб активный магазин не выбирает, но `campaign_id` обязателен, и если новый
 * токен прежний магазин не открывает, оставить его нельзя — бот ходил бы в
 * магазин, к которому нет доступа. Тогда берём первый из нового списка и
 * называем его в ответе; в боте его меняют обычной кнопкой.
 */
export function botStoreAfterToken(
  stores: readonly IStoreEntry[],
  currentCampaignId: string | undefined | null,
): { store: IStoreEntry; changed: boolean } | null {
  if (!stores.length) return null;
  const current = stores.find((store) => store.campaignId === currentCampaignId);
  return current ? { store: current, changed: false } : { store: stores[0], changed: true };
}
