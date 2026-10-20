/**
 * Необходимые закупки (TASK-151) — по скорости продаж и дням запаса. Чистая
 * функция: скорость — штуки товара в окне базы прогноза / N (тот же разрез
 * `pnl.skus`, что «Unit-экономика»), остаток — сумма по магазинам кабинета.
 *
 *   докупить = max(0, ⌈скорость × дни запаса − остаток⌉)
 *
 * Сумма закупа — по ТЕКУЩЕМУ закупу со скидкой бренда (как стоимость остатков
 * «Обзора»): закупать будут по сегодняшней цене. Товар без закупа считается
 * штуками и отдельным счётчиком, а не нулём рублей.
 */

import { daysLeftOf } from './inventory';

export const DEFAULT_COVER_DAYS = 30;
export const MIN_COVER_DAYS = 7;
export const MAX_COVER_DAYS = 120;

export function isCoverDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_COVER_DAYS &&
    value <= MAX_COVER_DAYS
  );
}

export interface IPurchaseNeedRow {
  sku: string;
  /** Штук в день за окно базы. */
  unitsPerDay: number;
  /** Доступно сейчас, сумма по магазинам; null — остатки не получены ни в одном магазине. */
  stock: number | null;
  /** На сколько дней хватит остатка; null — нет остатков или продаж. */
  daysLeft: number | null;
  /** Сколько докупить до `coverDays` дней запаса. */
  needUnits: number;
  /** Закуп штуки, копейки; null — закупа нет в прайсе. */
  unitCostKopecks: number | null;
  /** needUnits × закуп; null — закупа нет. */
  needKopecks: number | null;
}

export interface IPurchaseNeeds {
  coverDays: number;
  basisDays: number;
  rows: IPurchaseNeedRow[];
  totalUnits: number;
  totalKopecks: number;
  /** Нужно докупить, а закупа в прайсе нет. */
  withoutCost: { skus: number; units: number };
}

/**
 * @param soldUnits штуки товара в окне базы (продано минус вернулось)
 * @param stocks доступный остаток по артикулу; null — остатки не получены
 * @param costs закуп штуки в рублях (как `applyDiscounts`)
 */
export function purchaseNeedsOf(
  soldUnits: ReadonlyMap<string, number>,
  stocks: ReadonlyMap<string, number> | null,
  costs: ReadonlyMap<string, number>,
  basisDays: number,
  coverDays: number,
): IPurchaseNeeds {
  const rows: IPurchaseNeedRow[] = [];
  const withoutCost = { skus: 0, units: 0 };
  let totalUnits = 0;
  let totalKopecks = 0;

  for (const [sku, units] of soldUnits) {
    if (!(units > 0)) continue;
    const unitsPerDay = units / basisDays;
    const stock = stocks ? Math.max(0, stocks.get(sku) ?? 0) : null;
    const needUnits = Math.max(0, Math.ceil(unitsPerDay * coverDays - (stock ?? 0)));
    const rub = costs.get(sku);
    const unitCostKopecks =
      rub === undefined || !Number.isFinite(rub) ? null : Math.round(rub * 100);
    const needKopecks = unitCostKopecks === null ? null : unitCostKopecks * needUnits;

    rows.push({
      sku,
      unitsPerDay: Math.round(unitsPerDay * 100) / 100,
      stock,
      daysLeft: stock === null ? null : daysLeftOf(stock, unitsPerDay),
      needUnits,
      unitCostKopecks,
      needKopecks,
    });
    totalUnits += needUnits;
    if (needKopecks === null) {
      if (needUnits > 0) {
        withoutCost.skus += 1;
        withoutCost.units += needUnits;
      }
    } else {
      totalKopecks += needKopecks;
    }
  }

  // Сначала то, что кончится раньше; без остатков — по скорости.
  rows.sort(
    (a, b) =>
      (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER) ||
      b.unitsPerDay - a.unitsPerDay ||
      a.sku.localeCompare(b.sku),
  );

  return { coverDays, basisDays, rows, totalUnits, totalKopecks, withoutCost };
}
