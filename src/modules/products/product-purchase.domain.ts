import type { IProductPurchase } from './product.domain';

import { PRODUCT_BASE_CURRENCY } from './product.domain';

/**
 * Ручная правка закупа из CRM «Товары» (TASK-118) — проверка ввода, без Nest.
 *
 * Отдельным листом, а не в product.domain.ts: тот уже держит себестоимость,
 * строки источников и сопоставление карточек, а проверка формы — четвёртая
 * забота с собственными текстами.
 */

/** Валюты закупа. Рубли — как их называет Partner API (`RUR`). */
export const PRODUCT_CURRENCIES = [PRODUCT_BASE_CURRENCY, 'USD', 'EUR', 'CNY'] as const;

export type TProductCurrency = (typeof PRODUCT_CURRENCIES)[number];

/** Поле формы, под которое фронт ставит ошибку. */
export type TPurchaseField = 'price' | 'currency' | 'rate' | 'extraCosts';

export type TPurchaseValidation =
  | { ok: true; purchase: IProductPurchase }
  | { ok: false; field: TPurchaseField; message: string };

/** Ввод формы: числа приходят и строкой с запятой («1 234,5»). */
export interface IManualPurchaseInput {
  price?: unknown;
  currency?: unknown;
  rate?: unknown;
  extraCosts?: unknown;
}

/**
 * Проверка ручного закупа. Цена > 0: нулевой закуп сделал бы прибыль по товару
 * правдоподобной и ложной (довод `orderPurchase`). Курс обязателен для валюты —
 * без него `productCost` вернёт «неизвестно», и правка молча выбила бы товар из
 * «Прибыли». Доп. расходы — не меньше нуля; пусто — нет.
 */
export function validateManualPurchase(input: IManualPurchaseInput): TPurchaseValidation {
  const price = numberOf(input?.price);
  if (price === null || price <= 0) {
    return { ok: false, field: 'price', message: 'Укажите закупочную цену больше нуля' };
  }

  const currency = currencyOf(input?.currency);
  if (!currency) {
    return {
      ok: false,
      field: 'currency',
      message: `Валюта — одна из: ${PRODUCT_CURRENCIES.join(', ')}`,
    };
  }

  const purchase: IProductPurchase = { price, currency };

  if (currency !== PRODUCT_BASE_CURRENCY) {
    const rate = numberOf(input?.rate);
    if (rate === null || rate <= 0) {
      return {
        ok: false,
        field: 'rate',
        message: 'Укажите курс: сколько рублей за единицу валюты',
      };
    }
    purchase.rate = rate;
  }

  if (!isBlank(input?.extraCosts)) {
    const extra = numberOf(input?.extraCosts);
    if (extra === null || extra < 0) {
      return { ok: false, field: 'extraCosts', message: 'Доп. расходы — число не меньше нуля' };
    }
    if (extra > 0) purchase.extraCosts = extra;
  }

  return { ok: true, purchase };
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  // `\s` ловит и неразрывный пробел, которым Excel и браузер делят разряды.
  const text = value.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function currencyOf(value: unknown): TProductCurrency | null {
  if (isBlank(value)) return PRODUCT_BASE_CURRENCY;
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  const normalized = code === 'RUB' ? PRODUCT_BASE_CURRENCY : code;
  return (PRODUCT_CURRENCIES as readonly string[]).includes(normalized)
    ? (normalized as TProductCurrency)
    : null;
}
