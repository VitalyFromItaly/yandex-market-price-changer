import type { ITariffUnitCost } from './tariff-estimate';

import { serviceLabel } from './tariff-estimate';

/**
 * Тариф Маркета для одного товара по одной цене — ставки калькулятора цен
 * (TASK-139, решение `price_calc_tariff_check`). Чистая арифметика поверх
 * ответа `tariffs/calculate` за единицу (`unitCostsOf`).
 *
 * Услуги делятся по природе так же, как колонки unit-экономики: размещение,
 * приём и перевод платежа берутся процентом от цены — это ставка комиссии;
 * доставка, обработка, средняя миля — рубли на штуку, это логистика.
 * Незнакомый код услуги уходит в логистику: рубли на штуку — безопасное
 * направление, при росте цены он не растёт и минимальную цену не занижает.
 */

/** Услуги, которые Маркет берёт процентом от цены (колонка `commission` unit-экономики). */
export const PERCENT_TARIFF_SERVICES: ReadonlySet<string> = new Set([
  'FEE',
  'AGENCY_COMMISSION',
  'PAYMENT_TRANSFER',
]);

export interface ITariffQuoteService {
  type: string;
  label: string;
  kopecks: number;
  /** true — процент от цены (комиссия), false — на штуку (логистика). */
  percent: boolean;
}

export interface ITariffQuote {
  /** Цена, по которой спрошен тариф, копейки. */
  priceKopecks: number;
  /** Доля процентных услуг в цене. */
  commissionRate: number;
  /** Услуги на штуку, копейки. */
  logisticsKopecks: number;
  services: ITariffQuoteService[];
}

/** Ответ калькулятора за единицу → ставки калькулятора цен. */
export function splitQuote(priceKopecks: number, cost: ITariffUnitCost): ITariffQuote {
  const services = Object.entries(cost.byService).map(([type, rubles]) => ({
    type,
    label: serviceLabel(type),
    kopecks: Math.round(rubles * 100),
    percent: PERCENT_TARIFF_SERVICES.has(type),
  }));
  const percentKopecks = services.filter((s) => s.percent).reduce((sum, s) => sum + s.kopecks, 0);
  const logisticsKopecks = services
    .filter((s) => !s.percent)
    .reduce((sum, s) => sum + s.kopecks, 0);
  return {
    priceKopecks,
    commissionRate: priceKopecks > 0 ? percentKopecks / priceKopecks : 0,
    logisticsKopecks,
    services,
  };
}
