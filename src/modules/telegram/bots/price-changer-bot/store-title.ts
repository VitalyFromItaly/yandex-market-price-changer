import type { IPlacementRef } from '../../../yandex/stocks/placement';

import { placementOfCampaign } from '../../../yandex/stocks/placement';

/**
 * Как магазин называется продавцу: «Время с SBrand · FBY».
 *
 * ЕДИНСТВЕННОЕ место, где имя склеивается с моделью размещения. Второй такой
 * склейки быть не должно — это ровно та беда, ради которой в проекте появились
 * `menu.constants.ts` и `access-decision.text.ts`: две копии подписи расходятся
 * молча, и один экран начинает называть магазин иначе, чем соседний.
 *
 * Зачем модель вообще. Названия магазинов НЕ уникальны: на боевом аккаунте у
 * одного продавца две кампании называются «Время с SBrand» — 148655119 (FBS) и
 * 148704883 (FBY). Без модели сообщение «Магазин переключён: Время с SBrand»
 * не отвечает на вопрос, куда переключились, а разница принципиальная: на FBY
 * остатки записать нельзя (правило в `yandex/stocks/placement.ts`), и продавец
 * узнал бы об этом только когда бот откажется принимать прайс.
 */

/** Разделитель имени и модели. Один на всё приложение. */
const SEPARATOR = ' · ';

/**
 * Имя плюс модель, если модель известна.
 *
 * Неизвестная модель просто не печатается: догадка здесь хуже умолчания —
 * приписать магазину FBS, когда кэш ещё не заполнен, значит пообещать запись
 * остатков там, где её может не быть.
 */
export function withPlacement(name: string, placementType?: string): string {
  const clean = placementType?.trim();
  return clean ? `${name}${SEPARATOR}${clean}` : name;
}

/** Документ магазина в объёме, нужном для подписи. */
export interface IStoreTitleSource {
  name?: string;
  campaign_id?: string;
  stores?: readonly IPlacementRef[];
}

/**
 * Подпись подключённого магазина по документу `YandexMarket`.
 *
 * Модель ВЫВОДИТСЯ из кэша `stores` по `campaign_id`, а не хранится отдельным
 * полем документа: второе поле разъехалось бы с кэшем при первой же смене
 * магазина мимо бота, а вывод самоисправляется, как только кэш обновят. Кэша
 * нет — печатаем голое имя.
 *
 * `fallback` нужен экранам, где пустое имя недопустимо: настройки показывают
 * «✅ подключён», профиль — своё.
 */
export function storeTitle(store: IStoreTitleSource | null | undefined, fallback = ''): string {
  const name = store?.name?.trim();
  if (!name) return fallback;

  return withPlacement(name, placementOfCampaign(store?.stores, store?.campaign_id));
}
