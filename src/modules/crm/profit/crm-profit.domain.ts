import type { IProfitTotals } from '../../yandex/reports/profit';
import type { IProfitReport, ITariffCalcReport } from '../../yandex/reports/profit.service';
import type { TReportKey } from '../../yandex/reports/report-status-map';
import type { ITariffService } from '../../yandex/reports/tariff-calc-message';
import type { ICrmPeriodEcho } from '../jobs/crm-period.domain';

import { moscowDateParam } from '../../yandex/reports/moscow-day';
import {
  NO_PRICES_TEXT,
  OTHER_ORDERS_NOTE,
  PLACED_IN_TRANSIT_NOTE,
  PROFIT_EMPTY_TEXT,
  UNKNOWN_SKUS_ADVICE,
  isProfitEmpty,
  mainTariffEstimate,
  profitExcluded,
  profitMainBlock,
  promoParts,
  purchaseBasis,
  purchaseBasisText,
  tariffEstimateShare,
} from '../../yandex/reports/profit-message';
import { periodTitle } from '../../yandex/reports/report-period';
import { REPORT, reportDefinition } from '../../yandex/reports/report-status-map';
import {
  TARIFF_APPROX_NOTE,
  TARIFF_EXCLUDED_REASON,
  TARIFF_NOTHING_COUNTED,
  TARIFF_NO_PRICES_TEXT,
  flatComparison,
  flatComparisonText,
  servicesBreakdown,
  servicesShare,
} from '../../yandex/reports/tariff-calc-message';
import { periodEcho } from '../jobs/crm-period.domain';

/**
 * «Прибыль» и «Калькулятор» в CRM — чистая часть: вид ответа.
 *
 * Здесь НЕТ ни одной денежной формулы: числа — из `ProfitService.build` /
 * `buildTariffReport` (тот же вызов, что у бота), решения и тексты — из
 * plain-хелперов рядом с форматтерами бота (profit-message, tariff-calc-message).
 * Своя арифметика здесь была бы второй копией, которая однажды разойдётся с
 * ботом «на рубль».
 */

/** Вкладки раздела — в порядке показа. */
export const CRM_PROFIT_REPORTS = [
  REPORT.PROFIT,
  REPORT.TARIFF_CALC,
] as const satisfies readonly TReportKey[];

export type TCrmProfitReport = (typeof CRM_PROFIT_REPORTS)[number];

/** Имя kind-а фоновой задачи: замок дедупа — на каждую вкладку свой. */
export function profitJobKind(key: TCrmProfitReport): string {
  return `profit:${key}`;
}

/** Столбец вычитаний одного набора заказов. */
export interface ICrmProfitBlock {
  orders: number;
  revenue: number;
  subsidies: number;
  commission: number;
  commissionPercent: number;
  tax: number;
  taxPercent: number;
  promo: number;
  purchase: number;
  net: number;
}

export interface ICrmExcluded {
  orders: number;
  revenue: number;
  /** Полный список — фронт показывает его таблицей, бот — первые пять. */
  skus: string[];
  reason: string;
}

export interface ICrmPurchaseBasis {
  /** Дата последней загрузки прайса, ДД-ММ-ГГГГ по Москве; null — закупа нет. */
  updatedAt: string | null;
  defaultPercent: number;
  overrides: { title: string; percent: number }[];
  /** Готовая строка — те же слова, что у бота: «Закуп: прайс от … минус 10% (…).» */
  text: string;
}

interface ICrmReportBase {
  period: ICrmPeriodEcho;
  title: string;
  periodTitle: string;
  emptyText: string;
}

export interface ICrmProfitView extends ICrmReportBase {
  key: typeof REPORT.PROFIT;
  empty: boolean;
  /** Какой набор получает полную разбивку (profitMainBlock бота). */
  main: 'placed' | 'redeemed';
  placed: ICrmProfitBlock;
  redeemed: ICrmProfitBlock;
  cancelled: number;
  returned: { orders: number; revenue: number };
  excluded: ICrmExcluded;
  /** Строка калькулятора под комиссией основного блока; null — нет. */
  estimate: { servicesTotal: number; share: string | null } | null;
  prices: ICrmPurchaseBasis;
  promo: string[];
  notes: { placed: string; otherOrders: string; unknownSkus: string };
}

export interface ICrmTariffView extends ICrmReportBase {
  key: typeof REPORT.TARIFF_CALC;
  empty: boolean;
  totalOrders: number;
  block: ICrmProfitBlock;
  servicesShare: string | null;
  services: ITariffService[];
  comparison: {
    commissionPercent: number;
    flat: number;
    diff: number;
    servicesHigher: boolean;
    /** Фраза сравнения — та же, что у бота, без разметки. */
    text: string;
  };
  returned: { orders: number; revenue: number };
  excluded: ICrmExcluded;
  prices: ICrmPurchaseBasis;
  notes: { placed: string; approx: string; nothingCounted: string };
}

function block(totals: IProfitTotals): ICrmProfitBlock {
  return {
    orders: totals.orders,
    revenue: totals.revenue,
    subsidies: totals.subsidies,
    commission: totals.commission,
    commissionPercent: totals.rates.commissionPercent,
    tax: totals.tax,
    taxPercent: totals.rates.taxPercent,
    promo: totals.promo,
    purchase: totals.purchase,
    net: totals.net,
  };
}

function prices(
  updatedAt: Date | null,
  rates: IProfitTotals['rates'],
  missingText: string,
): ICrmPurchaseBasis {
  const basis = purchaseBasis(rates);
  return {
    updatedAt: updatedAt ? moscowDateParam(updatedAt) : null,
    defaultPercent: basis.defaultPercent,
    overrides: basis.overrides,
    text: updatedAt ? `Закуп: ${purchaseBasisText(updatedAt, rates)}` : missingText,
  };
}

function base(key: TCrmProfitReport, report: { period: IProfitReport['period'] }, now: Date) {
  return {
    period: periodEcho(report.period),
    title: reportDefinition(key).title,
    periodTitle: periodTitle(report.period, now),
    emptyText: PROFIT_EMPTY_TEXT,
  };
}

export function toCrmProfitView(report: IProfitReport, now: Date): ICrmProfitView {
  const { totals, placed } = report;
  const estimate = mainTariffEstimate(report);
  return {
    key: REPORT.PROFIT,
    ...base(REPORT.PROFIT, report, now),
    empty: isProfitEmpty(report),
    main: profitMainBlock(report),
    placed: block(placed),
    redeemed: block(totals),
    cancelled: report.cancelledOrders,
    returned: { orders: totals.returnedOrders, revenue: totals.returnedRevenue },
    excluded: { ...profitExcluded(report), reason: 'нет закупочной цены' },
    estimate: estimate
      ? { servicesTotal: estimate.servicesTotal, share: tariffEstimateShare(estimate) }
      : null,
    prices: prices(report.pricesUpdatedAt, placed?.rates ?? totals.rates, NO_PRICES_TEXT),
    promo: promoParts(placed?.rates ?? totals.rates),
    notes: {
      placed: PLACED_IN_TRANSIT_NOTE,
      otherOrders: OTHER_ORDERS_NOTE,
      unknownSkus: UNKNOWN_SKUS_ADVICE,
    },
  };
}

export function toCrmTariffView(report: ITariffCalcReport, now: Date): ICrmTariffView {
  const { totals } = report;
  return {
    key: REPORT.TARIFF_CALC,
    ...base(REPORT.TARIFF_CALC, report, now),
    empty: !report.totalOrders,
    totalOrders: report.totalOrders,
    block: block(totals),
    servicesShare: servicesShare(report),
    services: servicesBreakdown(report.byService),
    comparison: {
      commissionPercent: report.commissionPercent,
      ...flatComparison(report),
      text: flatComparisonText(report),
    },
    returned: { orders: totals.returnedOrders, revenue: totals.returnedRevenue },
    excluded: {
      orders: totals.excludedOrders,
      revenue: totals.excludedRevenue,
      skus: totals.unknownSkus,
      reason: TARIFF_EXCLUDED_REASON,
    },
    prices: prices(report.pricesUpdatedAt, totals.rates, TARIFF_NO_PRICES_TEXT),
    notes: {
      placed: PLACED_IN_TRANSIT_NOTE,
      approx: TARIFF_APPROX_NOTE,
      nothingCounted: TARIFF_NOTHING_COUNTED,
    },
  };
}
