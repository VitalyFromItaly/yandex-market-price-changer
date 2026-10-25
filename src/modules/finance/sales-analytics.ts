/**
 * «Аналитика продаж» (TASK-140, ТЗ п.9) — разрезы продаж периода: по дням, по
 * товарам, по брендам и по площадкам. Чистая функция над готовым `IPnl`: числа
 * берутся из того же `pnlOf`, что «Финансы», «Обзор» и «Unit-экономика», здесь
 * только свёртка и производные (средний чек, скорость продаж).
 *
 * Σ любого разреза = итог периода, и держится это построением, а не сверкой:
 * - дни — `pnl.salesByDay`, накопленный в проходе `pnlOf` (`pnl-sales.ts`);
 * - товары — `pnl.skus` (`pnl-sku.ts`) плюс строка «не относится к товару»
 *   (`rest`): продажи без артикула и без заказа тоже выручка, и без неё Σ
 *   товаров была бы меньше итога;
 * - бренды — свёртка ТЕХ ЖЕ строк товаров по `brandOf`, плюс та же `rest`;
 * - площадки — журнал пока только ЯМ, строка ЯМ = итог.
 *
 * Заказы складываются в итог только по дням (заказ — в день первой продажи).
 * По товарам и брендам заказ из нескольких артикулов считается в каждом, так
 * что Σ заказов там больше итога — это свойство разреза, а не ошибка; экран
 * говорит об этом строкой.
 */

import type { IPnl } from './pnl';
import type { TMarketplace } from '../../shared/marketplace';
import type { IBrandSource, TBrandKey } from '../yandex/reports/brands';

import { BRAND_KEYS, brandOf, brandTitle } from '../yandex/reports/brands';

/** Показатели одной строки разреза. */
export interface ISalesFigures {
  /** Продажи + субсидии − возвраты, копейки — та же выручка, что в «Финансах». */
  revenueKopecks: number;
  /** Продано минус вернулось, штук. */
  units: number;
  /** Различных заказов со строкой продажи. */
  orders: number;
  /** Выручка / заказы; null — заказов нет. */
  avgCheckKopecks: number | null;
  /** Штук в день за весь период (с днями без продаж); null — дней нет. */
  unitsPerDay: number | null;
}

export interface ISalesDay {
  day: string;
  revenueKopecks: number;
  units: number;
  orders: number;
}

export interface ISalesSku extends ISalesFigures {
  sku: string;
  /** Название из базы товаров; null — товара в базе нет. */
  name: string | null;
  /** Бренд из реестра; null — «Остальные». */
  brand: TBrandKey | null;
}

/** Бренд или «Остальные» (`key: null`). */
export interface ISalesBrand extends ISalesFigures {
  key: TBrandKey | null;
  title: string;
  /** Товаров с движением в периоде. */
  skus: number;
}

/** Продажи, не отнесённые к товару: без артикула и без заказа с артикулами. */
export interface ISalesRest {
  revenueKopecks: number;
  units: number;
}

export interface ISalesMarketplace extends ISalesFigures {
  marketplace: TMarketplace;
}

export interface ISalesAnalytics {
  /** Дней в периоде — знаменатель скорости продаж. */
  periodDays: number;
  totals: ISalesFigures;
  days: ISalesDay[];
  /** По выручке, по убыванию. */
  skus: ISalesSku[];
  /** Бренды в порядке реестра, «Остальные» последними. */
  brands: ISalesBrand[];
  rest: ISalesRest;
  marketplaces: ISalesMarketplace[];
}

export const OTHER_BRAND_TITLE = 'Остальные';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Дней в периоде включительно; даты — ГГГГ-ММ-ДД. */
export function periodDaysOf(period: { from: string; to: string }): number {
  const diff = Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`);
  return Number.isFinite(diff) && diff >= 0 ? Math.round(diff / DAY_MS) + 1 : 0;
}

/** Средний чек и скорость — одной функцией для итога и каждой строки. */
export function salesFigures(
  revenueKopecks: number,
  units: number,
  orders: number,
  periodDays: number,
): ISalesFigures {
  return {
    revenueKopecks,
    units,
    orders,
    avgCheckKopecks: orders > 0 ? Math.round(revenueKopecks / orders) : null,
    unitsPerDay: periodDays > 0 ? units / periodDays : null,
  };
}

/** Разрезы продаж периода. `products` — название и категория по артикулу ЯМ. */
export function salesAnalyticsOf(
  pnl: IPnl,
  products: ReadonlyMap<string, IBrandSource>,
  marketplace: TMarketplace = 'ym',
): ISalesAnalytics {
  const periodDays = periodDaysOf(pnl.period);
  const figures = (revenue: number, units: number, orders: number) =>
    salesFigures(revenue, units, orders, periodDays);

  const skus: ISalesSku[] = pnl.skus.skus
    .map((row) => {
      const product = products.get(row.sku);
      return {
        sku: row.sku,
        name: product?.name || null,
        brand: product ? brandOf(product) : null,
        ...figures(row.columns.revenue, row.units, row.orders),
      };
    })
    .sort((a, b) => b.revenueKopecks - a.revenueKopecks || a.sku.localeCompare(b.sku));

  const byBrand = new Map<
    TBrandKey | null,
    { revenue: number; units: number; orders: number; skus: number }
  >();
  for (const row of skus) {
    const entry = byBrand.get(row.brand) ?? { revenue: 0, units: 0, orders: 0, skus: 0 };
    entry.revenue += row.revenueKopecks;
    entry.units += row.units;
    entry.orders += row.orders;
    entry.skus += 1;
    byBrand.set(row.brand, entry);
  }
  const brands: ISalesBrand[] = [...BRAND_KEYS, null]
    .filter((key) => byBrand.has(key))
    .map((key) => {
      const entry = byBrand.get(key) as {
        revenue: number;
        units: number;
        orders: number;
        skus: number;
      };
      return {
        key,
        title: key ? brandTitle(key) : OTHER_BRAND_TITLE,
        skus: entry.skus,
        ...figures(entry.revenue, entry.units, entry.orders),
      };
    });

  const totals = figures(pnl.revenueKopecks, pnl.units, pnl.ordersCount);

  return {
    periodDays,
    totals,
    days: pnl.salesByDay.map((day) => ({ ...day })),
    skus,
    brands,
    rest: { revenueKopecks: pnl.skus.rest.columns.revenue, units: pnl.skus.rest.units },
    // P&L — журнал одной площадки (TASK-181): её строка и есть итог.
    marketplaces: [{ marketplace, ...totals }],
  };
}
