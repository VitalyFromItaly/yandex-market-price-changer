/**
 * «Магазины»: магазины токена продавца. В вебе магазин не переключают, а
 * открывают — отчёты внутри считаются по магазину из адреса
 * (`/ym/stores/:store/...`), активный магазин бота веб не трогает.
 *
 * Магазин адресуется `key` — хэшем от кампании: ни campaign_id, ни
 * business_id, ни токен в ответы не попадают.
 */

export const STORES_ROUTE_NAME = 'ym-stores';
/** Параметр пути с ключом магазина — его читают все разделы внутри магазина. */
export const STORE_PARAM = 'store';

export interface StoreItemResponse {
  key: string;
  /** Имя с моделью — та же подпись, что на кнопке пикера бота. */
  label: string;
  businessName: string;
  placementType: string | null;
}

export interface StoresResponse {
  stores: StoreItemResponse[];
}

export interface StoreViewResponse extends StoreItemResponse {
  /** Разделы магазина по ЕГО модели (FBS/FBY) и фичам продавца. */
  sections: string[];
}

export interface StoreItem {
  key: string;
  label: string;
  /** Кабинет; пустой — колонка показывает прочерк. */
  businessName: string | null;
  placementType: string | null;
}

export interface StoreView extends StoreItem {
  sections: string[];
}
