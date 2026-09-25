import type { IBrandSource, TBrandKey } from '../reports/brands';
import type { TRateField } from '../reports/profit';
import type { TPromoConfig } from '../reports/promo';

import { brandDiscountTitle, brandTitle, brandUsageOf, isBrandKey } from '../reports/brands';
import {
  RATE_FIELDS,
  brandDiscountOf,
  discountsOf,
  ratesOf,
  validatePercent,
  validateRate,
} from '../reports/profit';
import {
  promoConfigsOf,
  promoPercentTitle,
  promoWithFloor,
  validatePromoFrom,
  validatePromoLimit,
} from '../reports/promo';

/**
 * Настройки прибыли магазина: ставки, скидки по брендам, продвижение.
 *
 * ОДНА проверка на оба канала. Бот задаёт вопросы по одному и проверяет каждый
 * ответ, CRM присылает форму целиком, но правила у обоих из одних функций
 * (`validateRate`, `validatePercent`, `validatePromoFrom/Limit`), и окончательная
 * проверка перед записью идёт здесь. Вторая копия правил разошлась бы с первой,
 * как когда-то расходились копии экрана настроек.
 *
 * Чистый модуль, без Nest и Mongo. Фичи здесь НЕ проверяются: `UserAccess`
 * принадлежит слою telegram/CRM (довод `ProfitService`).
 */

/**
 * Итог проверки. `field` показывает, какое поле не принято (`commissionPercent`,
 * `brandDiscounts.casio`, `limit`…), чтобы веб поставил ошибку под нужное поле.
 * Боту хватает `error`.
 */
export type TSettingsValidation<T> =
  | { ok: true; value: T }
  | { ok: false; field: string; error: string };

/** Ставки и скидки по брендам. Любое поле необязательно: пишется только присланное. */
export interface IProfitSettingsInput {
  commissionPercent?: number;
  taxPercent?: number;
  discountPercent?: number;
  brandDiscounts?: Readonly<Record<string, number>>;
}

export interface IProfitSettings {
  rates: Partial<Record<TRateField, number>>;
  brandDiscounts: Partial<Record<TBrandKey, number>>;
}

export function validateProfitSettings(
  input: IProfitSettingsInput,
): TSettingsValidation<IProfitSettings> {
  const rates: Partial<Record<TRateField, number>> = {};

  for (const field of RATE_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;

    const check = validateRate(field, value);
    if (!check.ok) return { ok: false, field, error: check.error };
    rates[field] = value;
  }

  const brandDiscounts: Partial<Record<TBrandKey, number>> = {};

  for (const [key, value] of Object.entries(input.brandDiscounts ?? {})) {
    const field = `brandDiscounts.${key}`;
    // Ключ уходит в путь `$set`: неизвестный бренд отбивается здесь, не в базе.
    if (!isBrandKey(key)) return { ok: false, field, error: `Неизвестный бренд: ${key}.` };

    const check = validatePercent(brandDiscountTitle(key), value);
    if (!check.ok) return { ok: false, field, error: check.error };
    brandDiscounts[key] = value;
  }

  return { ok: true, value: { rates, brandDiscounts } };
}

/**
 * Настройка продвижения одного бренда в том виде, как её присылает форма.
 * `from` пустой или 0 значит «порога нет».
 */
export type TPromoInput =
  | { mode: 'flat'; percent: number; from?: number | null }
  | { mode: 'tiered'; limit: number; below: number; above: number; from?: number | null };

/**
 * Проверить настройку продвижения целиком и привести её к хранимой форме.
 *
 * Функции те же, что у пошагового диалога бота. `promoWithFloor` в конце
 * гарантирует, что ноль в пороге до базы не доходит: `from: 0` в документе
 * `promoConfigsOf` считает мусором и выбрасывает запись целиком.
 */
export function validatePromoInput(
  brand: TBrandKey,
  input: TPromoInput,
): TSettingsValidation<TPromoConfig> {
  const from = input.from ?? 0;
  const fromCheck = validatePromoFrom(from);
  if (!fromCheck.ok) return { ok: false, field: 'from', error: fromCheck.error };

  if (input.mode === 'flat') {
    const check = validatePercent(promoPercentTitle(brand, 'flat'), input.percent);
    if (!check.ok) return { ok: false, field: 'percent', error: check.error };

    return { ok: true, value: promoWithFloor({ mode: 'flat', percent: input.percent }, from) };
  }

  if (input.mode === 'tiered') {
    const limitCheck = validatePromoLimit(input.limit);
    if (!limitCheck.ok) return { ok: false, field: 'limit', error: limitCheck.error };

    const belowCheck = validatePercent(promoPercentTitle(brand, 'below'), input.below);
    if (!belowCheck.ok) return { ok: false, field: 'below', error: belowCheck.error };

    const aboveCheck = validatePercent(promoPercentTitle(brand, 'above'), input.above);
    if (!aboveCheck.ok) return { ok: false, field: 'above', error: aboveCheck.error };

    return {
      ok: true,
      value: promoWithFloor(
        { mode: 'tiered', limit: input.limit, below: input.below, above: input.above },
        from,
      ),
    };
  }

  return { ok: false, field: 'mode', error: 'Режим продвижения: общий процент или по цене.' };
}

// --- снимок для показа ---------------------------------------------------------

export interface IBrandSettings {
  key: TBrandKey;
  title: string;
  /** Позиций бренда в прайсе продавца. */
  count: number;
  /** Действующая скидка, с учётом дефолта и легаси «Востока». */
  discountPercent: number;
  promo: TPromoConfig | null;
}

export interface IStoreSettings {
  commissionPercent: number;
  taxPercent: number;
  /** Скидка для брендов без своей настройки — строка «Остальные». */
  discountPercent: number;
  /** Только бренды из прайса продавца, в порядке реестра. */
  brands: IBrandSettings[];
  /** Позиций вне реестра брендов — идут по общей скидке. */
  otherCount: number;
}

/**
 * Что показать на экране настроек. Бренды — только присутствующие в прайсе:
 * настройка бренда, которого у продавца нет, ни на что не влияет (довод экрана
 * скидок в боте). Проценты — ДЕЙСТВУЮЩИЕ: продавец сверяет с ними отчёт.
 */
export function storeSettingsOf(
  store: Parameters<typeof ratesOf>[0],
  rows: readonly IBrandSource[],
): IStoreSettings {
  const rates = ratesOf(store);
  const discounts = discountsOf(store);
  const promos = promoConfigsOf(store?.promoCommissions);
  const { usage, otherCount } = brandUsageOf(rows);

  return {
    commissionPercent: rates.commissionPercent,
    taxPercent: rates.taxPercent,
    discountPercent: discounts.defaultPercent,
    brands: usage.map(({ key, count }) => ({
      key,
      title: brandTitle(key),
      count,
      discountPercent: brandDiscountOf(discounts, key),
      promo: promos[key] ?? null,
    })),
    otherCount,
  };
}
