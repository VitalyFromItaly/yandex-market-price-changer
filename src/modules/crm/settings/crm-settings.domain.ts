import type { TPromoConfig } from '../../yandex/reports/promo';
import type {
  IProfitSettingsInput,
  IStoreSettings,
  TPromoInput,
} from '../../yandex/settings/store-settings.domain';

import { promoValueLabel } from '../../yandex/reports/promo';

/**
 * Раздел «Настройки» CRM: вид для фронта и разбор тел запросов.
 *
 * Проверки здесь НЕТ: только форма входа (число/не число, какие ключи). Правила
 * живут в store-settings.domain.ts, общем с ботом. Нечисло сюда приходит как
 * NaN, и ошибку формулирует та же `validatePercent`, что отвечает продавцу в
 * боте.
 */

/** 400: значение не принято; `field` показывает, под каким полем ошибка. */
export const INVALID_SETTING = 'INVALID_SETTING';
/** 409: магазина нет, настраивать нечего. */
export const NO_STORE = 'NO_STORE';

export const NO_STORE_TEXT = 'Магазин не подключён — подключите его в боте.';

export interface ICrmBrandDiscountView {
  key: string;
  title: string;
  count: number;
  discountPercent: number;
}

export interface ICrmPromotionView {
  key: string;
  title: string;
  count: number;
  config: TPromoConfig | null;
  /** «от 3 000 ₽: до 10 000 ₽ — 2%, свыше — 1%» | «—»: та же подпись, что в боте. */
  label: string;
}

export interface ICrmSettingsView {
  commissionPercent: number;
  taxPercent: number;
  discountPercent: number;
  brands: ICrmBrandDiscountView[];
  otherCount: number;
  /** null — фича promotion закрыта, блок не показывается. */
  promotion: ICrmPromotionView[] | null;
}

/**
 * Вид собирается перечислением полей, а не спредом документа: токен и
 * идентификаторы магазина наружу не уходят (правило `/auth/me`).
 */
export function toCrmSettingsView(
  settings: IStoreSettings,
  promotionOpen: boolean,
): ICrmSettingsView {
  return {
    commissionPercent: settings.commissionPercent,
    taxPercent: settings.taxPercent,
    discountPercent: settings.discountPercent,
    brands: settings.brands.map(({ key, title, count, discountPercent }) => ({
      key,
      title,
      count,
      discountPercent,
    })),
    otherCount: settings.otherCount,
    promotion: promotionOpen
      ? settings.brands.map(({ key, title, count, promo }) => ({
          key,
          title,
          count,
          config: promo,
          label: promoValueLabel(promo ?? undefined),
        }))
      : null,
  };
}

/** Число из JSON. Строку с запятой тоже принимаем: так пишут руками. Остальное — NaN. */
function numberOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value.replace(',', '.'));
  return Number.NaN;
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : numberOf(value);
}

/** Тело `PUT /settings`. Пропущенное поле не меняется. */
export function parseProfitSettingsBody(body: unknown): IProfitSettingsInput {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const input: IProfitSettingsInput = {};

  const commission = optionalNumber(raw.commissionPercent);
  if (commission !== undefined) input.commissionPercent = commission;
  const tax = optionalNumber(raw.taxPercent);
  if (tax !== undefined) input.taxPercent = tax;
  const discount = optionalNumber(raw.discountPercent);
  if (discount !== undefined) input.discountPercent = discount;

  if (typeof raw.brandDiscounts === 'object' && raw.brandDiscounts !== null) {
    input.brandDiscounts = Object.fromEntries(
      Object.entries(raw.brandDiscounts as Record<string, unknown>).map(([key, value]) => [
        key,
        numberOf(value),
      ]),
    );
  }

  return input;
}

/**
 * Тело `PUT /settings/promotion/:brand`. Неизвестный режим пропускается
 * как есть — отказ с полем `mode` формулирует `validatePromoInput`.
 */
export function parsePromoBody(body: unknown): TPromoInput {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const from = optionalNumber(raw.from);

  if (raw.mode === 'tiered') {
    return {
      mode: 'tiered',
      limit: numberOf(raw.limit),
      below: numberOf(raw.below),
      above: numberOf(raw.above),
      from,
    };
  }

  if (raw.mode === 'flat') return { mode: 'flat', percent: numberOf(raw.percent), from };

  return { mode: raw.mode, from } as unknown as TPromoInput;
}
