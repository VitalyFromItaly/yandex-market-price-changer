/**
 * Раздел «Настройки»: ставки, скидки по брендам, продвижение.
 *
 * Проверки значений на фронте НЕТ: правило одно на бот и CRM и живёт на сервере
 * (StoreSettingsService). Ошибка приходит с полем, форма ставит её под него.
 */

/** Настройка продвижения, как её хранит сервер. `from` нет — порога нет. */
export type PromoConfig =
  | { mode: 'flat'; percent: number; from?: number }
  | { mode: 'tiered'; limit: number; below: number; above: number; from?: number };

export type PromoMode = PromoConfig['mode'];

export interface BrandDiscount {
  key: string;
  title: string;
  /** Позиций бренда в прайсе продавца. */
  count: number;
  /** Действующая скидка — с учётом общей. */
  discountPercent: number;
}

export interface BrandPromotion {
  key: string;
  title: string;
  count: number;
  config: PromoConfig | null;
  /** Та же подпись, что в боте: «до 10 000 ₽ — 2%, свыше — 1%» | «—». */
  label: string;
}

/** Ответ GET/PUT /ym/settings. */
export interface SettingsResponse {
  commissionPercent: number;
  taxPercent: number;
  discountPercent: number;
  brands: BrandDiscount[];
  otherCount: number;
  /** null — продвижение закрыто администратором, блока нет. */
  promotion: BrandPromotion[] | null;
}

export type Settings = SettingsResponse;

/** Поля формы ставок и скидок — строки, как их набирает человек («23,5»). */
export interface ProfitForm {
  commissionPercent: string;
  taxPercent: string;
  discountPercent: string;
  /** Ключ — бренд. */
  brands: Record<string, string>;
}

/** Тело PUT /ym/settings: только изменённые поля. */
export interface ProfitSettingsBody {
  commissionPercent?: number | string;
  taxPercent?: number | string;
  discountPercent?: number | string;
  brandDiscounts?: Record<string, number | string>;
}

export interface PromoForm {
  mode: PromoMode;
  percent: string;
  limit: string;
  below: string;
  above: string;
  /** Пусто или 0 — порога нет. */
  from: string;
}

/** Тело PUT /ym/settings/promotion/:brand. */
export type PromoBody =
  | { mode: 'flat'; percent: number | string; from: number | string | null }
  | {
      mode: 'tiered';
      limit: number | string;
      below: number | string;
      above: number | string;
      from: number | string | null;
    };

/** Ошибки у полей: ключ — поле формы (`taxPercent`, `brand:casio`, `limit`), `form` — общая. */
export type SettingsErrors = Record<string, string>;

export const SETTINGS_ERROR_CODE = {
  INVALID_SETTING: 'INVALID_SETTING',
} as const;

/** Ключ ошибки поля скидки бренда в форме. */
export function brandFieldKey(brand: string): string {
  return `brand:${brand}`;
}
