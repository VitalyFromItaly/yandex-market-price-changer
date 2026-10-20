import type { TMarketplace } from '../../../shared/marketplace';
import type { IUnconfirmedProfit } from '../../../shared/profit-confirmation';
import type { IFinancePeriod } from '../../finance/finance-period';
import type { TFinancePeriodStatus } from '../../finance/finance-period-status';
import type { IPnlReport } from '../../finance/finance.service';
import type {
  ISalesAnalytics,
  ISalesBrand,
  ISalesDay,
  ISalesFigures,
  ISalesRest,
  ISalesSku,
} from '../../finance/sales-analytics';
import type { IBrandSource, TBrandKey } from '../../yandex/reports/brands';

import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { salesAnalyticsOf } from '../../finance/sales-analytics';

/**
 * «Аналитика продаж» CRM (TASK-140, ТЗ п.9) — доставка, уровня аккаунта.
 *
 * Разрезы считает `salesAnalyticsOf` (finance) над тем же `FinanceService.build`,
 * что «Финансы», «Обзор» и «Unit-экономика», поэтому итог совпадает с ними по
 * построению. Здесь — только сопоставление с прошлым периодом и перечисление
 * полей ответа.
 */

export const SALES_ANALYTICS_KIND = 'sales-analytics:summary';

export const SALES_ANALYTICS_RANGE_INVALID_TEXT =
  'Период не распознан: нужны даты начала и конца не длиннее года';

/** Выручка и штуки прошлого периода — для динамики строки. */
export interface ICrmSalesPrevious {
  revenueKopecks: number;
  units: number;
}

export interface ICrmSalesSku extends ISalesSku {
  /** null — в прошлом периоде товар не продавался. */
  previous: ICrmSalesPrevious | null;
}

export interface ICrmSalesBrand extends ISalesBrand {
  previous: ICrmSalesPrevious | null;
}

export interface ICrmSalesMarketplace extends ISalesFigures {
  marketplace: TMarketplace;
  label: string;
  previous: ICrmSalesPrevious | null;
}

export interface ICrmSalesAnalytics {
  period: IFinancePeriod;
  previousPeriod: IFinancePeriod;
  status: TFinancePeriodStatus;
  statusLabel: string;
  periodDays: number;
  totals: ISalesFigures;
  previousTotals: ISalesFigures;
  days: ISalesDay[];
  skus: ICrmSalesSku[];
  brands: ICrmSalesBrand[];
  rest: ISalesRest;
  marketplaces: ICrmSalesMarketplace[];
  /** Признак движка (TASK-119): у части продаж нет закупа — для продаж это справка, не ошибка. */
  unconfirmed: IUnconfirmedProfit;
}

const previousOf = (row: ISalesFigures | undefined): ICrmSalesPrevious | null =>
  row ? { revenueKopecks: row.revenueKopecks, units: row.units } : null;

const figuresOf = (row: ISalesFigures): ISalesFigures => ({
  revenueKopecks: row.revenueKopecks,
  units: row.units,
  orders: row.orders,
  avgCheckKopecks: row.avgCheckKopecks,
  unitsPerDay: row.unitsPerDay,
});

const brandId = (key: TBrandKey | null) => key ?? '';

/** Ответ раздела: текущий период с динамикой к прошлому по каждой строке. */
export function toCrmSalesAnalytics(
  current: IPnlReport,
  previous: IPnlReport,
  products: ReadonlyMap<string, IBrandSource>,
): ICrmSalesAnalytics {
  const now: ISalesAnalytics = salesAnalyticsOf(current.pnl, products);
  const before: ISalesAnalytics = salesAnalyticsOf(previous.pnl, products);
  const beforeSku = new Map(before.skus.map((row) => [row.sku, row]));
  const beforeBrand = new Map(before.brands.map((row) => [brandId(row.key), row]));
  const beforeMarketplace = new Map(before.marketplaces.map((row) => [row.marketplace, row]));

  return {
    period: current.pnl.period,
    previousPeriod: previous.pnl.period,
    status: current.status,
    statusLabel: current.statusLabel,
    periodDays: now.periodDays,
    totals: figuresOf(now.totals),
    previousTotals: figuresOf(before.totals),
    days: now.days.map((day) => ({ ...day })),
    skus: now.skus.map((row) => ({
      sku: row.sku,
      name: row.name,
      brand: row.brand,
      ...figuresOf(row),
      previous: previousOf(beforeSku.get(row.sku)),
    })),
    brands: now.brands.map((row) => ({
      key: row.key,
      title: row.title,
      skus: row.skus,
      ...figuresOf(row),
      previous: previousOf(beforeBrand.get(brandId(row.key))),
    })),
    rest: { revenueKopecks: now.rest.revenueKopecks, units: now.rest.units },
    marketplaces: now.marketplaces.map((row) => ({
      marketplace: row.marketplace,
      label: MARKETPLACE_LABEL[row.marketplace],
      ...figuresOf(row),
      previous: previousOf(beforeMarketplace.get(row.marketplace)),
    })),
    unconfirmed: current.pnl.unconfirmed,
  };
}
