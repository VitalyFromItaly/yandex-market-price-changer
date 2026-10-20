import type { IPriceCalcRates } from '../../finance/price-calc-rates';
import type { ITariffQuote } from '../../yandex/reports/tariff-quote';

/**
 * «Калькулятор цен» CRM (TASK-139, ТЗ п.8). Сама формула считается в браузере
 * (решение `price_calc_shared_leaf`), ставки собирает `PriceCalcRatesService`
 * финмодуля (TASK-165) — здесь только kind-ы и параметры тарифа.
 */

export const PRICE_CALC_RATES_KIND = 'price-calc:rates';
export const PRICE_CALC_TARIFF_KIND = 'price-calc:tariff';

export const PRICE_CALC_TARIFF_PARAMS_TEXT = 'Для тарифа нужны артикул и цена больше нуля';

/** Ответ kind-а ставок — сборка финмодуля как есть. */
export type ICrmPriceCalcRates = IPriceCalcRates;

export interface ICrmPriceCalcTariff extends ITariffQuote {
  sku: string;
}

/** Параметры тарифа из браузера: артикул и цена в копейках. Мусор → null. */
export function parseTariffParams(
  params: Record<string, unknown>,
): { sku: string; priceKopecks: number } | null {
  const sku = typeof params.sku === 'string' ? params.sku.trim() : '';
  const price = Number(params.priceKopecks);
  if (!sku || !Number.isInteger(price) || price <= 0) return null;
  return { sku, priceKopecks: price };
}
