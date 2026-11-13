/**
 * Аналитика «Финучёта» (TASK-230, ТЗ п.13). Чистые функции поверх карточек
 * заказов, оформленных в периоде (`AccountingOrderCardService.periodOrders`):
 * результат заказа — `orderResultOf` (`IComputedOrder.result`), результат
 * возврата — `returnResultOf` (`returnOfOrder`). Своих формул и статей нет —
 * здесь только суммы, средние и сортировки.
 *
 * Товар получает результат только однотоварных заказов (в неотменённых строках
 * один артикул, штук может быть несколько): результат заказа не делится на
 * позиции (решение `2026-11-11_accounting_analytics_models`). Заказы из
 * нескольких моделей отдаются счётчиком «не разнесены».
 *
 * Площадки не складываются в одно число: каждая строка несёт свою площадку.
 * Неизвестный результат — null, не 0 (`accounting_unknown_cost_strict`).
 */

import type { IComputedOrder } from './accounting-order-card.service';
import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { TOrderResultKey } from './order-result';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IFinancePeriod } from '../finance/finance-period';

import { MARKETPLACE_LABEL } from '../../shared/marketplace';
import { shiftDay } from '../finance/finance-period';

import { orderCreatedOn } from './accounting-dashboard.domain';
import { returnOfOrder } from './accounting-returns.domain';
import { isCancelledOrderLine, isReturnedOrderLine } from './order-result';

/** Сколько товаров в каждом из ТОПов и сколько убыточных заказов в списке. */
export const ANALYTICS_TOP = 100;
/** Сколько моделей в «наибольшие расходы на возвраты». */
export const ANALYTICS_RETURN_MODELS_TOP = 20;

export const ANALYTICS_NOT_CONNECTED_REASON =
  'Площадка не подключена или закрыта администратором — данных для сравнения нет.';
export const ANALYTICS_NO_STORE_REASON =
  'Магазин Яндекс.Маркета не выбран — его заказы здесь не показываются.';
export const ANALYTICS_NOT_LOADED_REASON =
  'Реестр операций площадки ещё ни разу не загрузился — сравнивать не с чем.';

// ── Типы ───────────────────────────────────────────────────────────────────

export interface IAnalyticsProduct {
  marketplace: TFinanceMarketplace;
  label: string;
  offerId: string;
  offerName: string | null;
  /** Однотоварных заказов модели в периоде. */
  ordersCount: number;
  units: number;
  /** Σ чистой прибыли однотоварных заказов; null — хоть у одного неизвестна. */
  profitKopecks: number | null;
  unknownCount: number;
}

export interface IAnalyticsProducts {
  mostProfitable: IAnalyticsProduct[];
  leastProfitable: IAnalyticsProduct[];
  /** Модели, у которых результат хоть одного заказа неизвестен, — в ТОПы не входят. */
  unknownModels: number;
  /** Заказы из нескольких моделей: результат не делится, в ТОП не разнесены. */
  multiModelOrders: number;
}

export interface IAnalyticsLossOrder {
  marketplace: TFinanceMarketplace;
  label: string;
  orderId: string;
  /** Названия моделей заказа. */
  title: string;
  createdOn: string | null;
  resultKopecks: number;
}

export interface IAnalyticsLossOrders {
  /** Самые убыточные первыми, не больше `ANALYTICS_TOP`. */
  orders: IAnalyticsLossOrder[];
  total: number;
}

export interface IAnalyticsReturnModel {
  marketplace: TFinanceMarketplace;
  label: string;
  offerId: string;
  offerName: string | null;
  returnedOrders: number;
  returnedUnits: number;
  /** Σ результатов возврата (`returnResultOf`); null — хоть один неизвестен. */
  resultKopecks: number | null;
}

export interface IAnalyticsReturnModels {
  models: IAnalyticsReturnModel[];
  /** Возвраты, где вернулись позиции нескольких моделей, — по моделям не разнесены. */
  multiModelReturns: number;
}

/** Средняя фактическая сумма строки карточки по заказам, где она пришла из реестра. */
export interface IAnalyticsAverage {
  /** Заказов с фактической строкой. */
  ordersCount: number;
  /** Σ / число заказов, со знаком журнала; null — фактических нет. */
  avgKopecks: number | null;
  /** Σ строки / Σ выручки тех же заказов, со знаком журнала; null — выручки нет. */
  shareOfRevenue: number | null;
}

export interface IAnalyticsMarketplaceData {
  marketplace: TFinanceMarketplace;
  label: string;
  insufficientData: false;
  /** Заказы периода, ушедшие покупателю (отменённые до продажи не считаются). */
  ordersCount: number;
  /** Σ строки «Выручка продавца»; null — у заказа она неизвестна. */
  revenueKopecks: number | null;
  /** Σ чистой прибыли заказов; null — хоть у одного неизвестна. */
  profitKopecks: number | null;
  unknownCount: number;
  /** Прибыль / выручка; null — одно из них неизвестно или выручки нет. */
  margin: number | null;
  commission: IAnalyticsAverage;
  logistics: IAnalyticsAverage;
}

export interface IAnalyticsMarketplaceMissing {
  marketplace: TFinanceMarketplace;
  label: string;
  insufficientData: true;
  reason: string;
}

export type TAnalyticsMarketplace = IAnalyticsMarketplaceData | IAnalyticsMarketplaceMissing;

export interface IAnalyticsDay {
  /** ГГГГ-ММ-ДД, день оформления заказа. */
  day: string;
  marketplace: TFinanceMarketplace;
  ordersCount: number;
  /** Σ чистой прибыли заказов дня; null — хоть у одного неизвестна. */
  profitKopecks: number | null;
  unknownCount: number;
}

export interface IAccountingAnalyticsSummary {
  products: IAnalyticsProducts;
  lossOrders: IAnalyticsLossOrders;
  returnModels: IAnalyticsReturnModels;
  /** Площадки рядом: данные или причина, почему их нет. */
  marketplaces: TAnalyticsMarketplace[];
  /** Прибыль по дням — по каждой площадке с данными отдельно. */
  days: IAnalyticsDay[];
}

/** Почему площадки нет в сравнении; null — данные есть. */
export type TAnalyticsAvailability = Record<TFinanceMarketplace, string | null>;

// ── Помощники ──────────────────────────────────────────────────────────────

const liveLines = (order: Pick<IComputedOrder, 'lines'>) =>
  order.lines.filter((l) => !isCancelledOrderLine(l));

const isShipped = (order: Pick<IComputedOrder, 'lines'>) => liveLines(order).length > 0;

/** Единственный артикул строк; null — строк нет, артикулов несколько или он пуст. */
function singleOffer(lines: readonly IAccountingOrderLineInput[]): string | null {
  const offers = new Set(lines.map((l) => l.offerId ?? ''));
  if (offers.size !== 1) return null;
  const [offerId] = offers;
  return offerId || null;
}

/** Модель однотоварного заказа (по неотменённым строкам); null — многотоварный или без артикула. */
export function modelOf(order: Pick<IComputedOrder, 'lines'>): string | null {
  return singleOffer(liveLines(order));
}

const netOf = (order: IComputedOrder): number | null => order.result.net?.kopecks ?? null;

const amountOf = (order: IComputedOrder, key: TOrderResultKey) =>
  order.result.amounts.find((a) => a.key === key);

const nameOf = (lines: readonly IAccountingOrderLineInput[], offerId: string) =>
  lines.find((l) => l.offerId === offerId && l.offerName)?.offerName ?? null;

const titleOf = (lines: readonly IAccountingOrderLineInput[]) =>
  [...new Set(lines.map((l) => l.offerName ?? l.offerId).filter(Boolean))].join(', ');

const addStrict = (sum: number | null, value: number | null) =>
  sum === null || value === null ? null : sum + value;

const ratio = (part: number | null, whole: number | null) =>
  part === null || whole === null || whole === 0 ? null : part / Math.abs(whole);

// ── Блоки ──────────────────────────────────────────────────────────────────

/** ТОП-100 самых и наименее прибыльных товаров — по однотоварным заказам. */
export function productsOf(orders: readonly IComputedOrder[]): IAnalyticsProducts {
  const byModel = new Map<string, IAnalyticsProduct>();
  let multiModelOrders = 0;

  for (const order of orders.filter(isShipped)) {
    const offerId = modelOf(order);
    if (!offerId) {
      multiModelOrders += 1;
      continue;
    }
    const lines = liveLines(order);
    const key = `${order.marketplace}|${offerId}`;
    const product = byModel.get(key) ?? {
      marketplace: order.marketplace,
      label: MARKETPLACE_LABEL[order.marketplace],
      offerId,
      offerName: null,
      ordersCount: 0,
      units: 0,
      profitKopecks: 0,
      unknownCount: 0,
    };
    product.ordersCount += 1;
    product.units += lines.reduce((sum, l) => sum + l.count, 0);
    product.offerName ??= nameOf(lines, offerId);
    const net = netOf(order);
    if (net === null) product.unknownCount += 1;
    product.profitKopecks = addStrict(product.profitKopecks, net);
    byModel.set(key, product);
  }

  const all = [...byModel.values()];
  const known = all.filter((p) => p.profitKopecks !== null);
  const tie = (a: IAnalyticsProduct, b: IAnalyticsProduct) =>
    a.marketplace.localeCompare(b.marketplace) || a.offerId.localeCompare(b.offerId);
  return {
    mostProfitable: [...known]
      .sort((a, b) => b.profitKopecks - a.profitKopecks || tie(a, b))
      .slice(0, ANALYTICS_TOP),
    leastProfitable: [...known]
      .sort((a, b) => a.profitKopecks - b.profitKopecks || tie(a, b))
      .slice(0, ANALYTICS_TOP),
    unknownModels: all.length - known.length,
    multiModelOrders,
  };
}

/** Убыточные заказы: чистая прибыль < 0, самые убыточные первыми. */
export function lossOrdersOf(orders: readonly IComputedOrder[]): IAnalyticsLossOrders {
  const losses: IAnalyticsLossOrder[] = [];
  for (const order of orders) {
    const net = netOf(order);
    if (net === null || net >= 0) continue;
    losses.push({
      marketplace: order.marketplace,
      label: MARKETPLACE_LABEL[order.marketplace],
      orderId: order.orderId,
      title: titleOf(order.lines),
      createdOn: orderCreatedOn(order.lines),
      resultKopecks: net,
    });
  }
  losses.sort(
    (a, b) =>
      a.resultKopecks - b.resultKopecks ||
      a.marketplace.localeCompare(b.marketplace) ||
      a.orderId.localeCompare(b.orderId),
  );
  return { orders: losses.slice(0, ANALYTICS_TOP), total: losses.length };
}

/** Модели с наибольшими расходами на возвраты — по возвратам одной модели. */
export function returnModelsOf(orders: readonly IComputedOrder[]): IAnalyticsReturnModels {
  const byModel = new Map<string, IAnalyticsReturnModel>();
  let multiModelReturns = 0;

  for (const order of orders) {
    const returned = order.lines.filter(isReturnedOrderLine);
    if (!returned.length) continue;
    const offerId = singleOffer(returned);
    if (!offerId) {
      multiModelReturns += 1;
      continue;
    }
    const key = `${order.marketplace}|${offerId}`;
    const model = byModel.get(key) ?? {
      marketplace: order.marketplace,
      label: MARKETPLACE_LABEL[order.marketplace],
      offerId,
      offerName: null,
      returnedOrders: 0,
      returnedUnits: 0,
      resultKopecks: 0,
    };
    model.returnedOrders += 1;
    model.returnedUnits += returned.reduce((sum, l) => sum + l.count, 0);
    model.offerName ??= nameOf(returned, offerId);
    model.resultKopecks = addStrict(model.resultKopecks, returnOfOrder(order).resultKopecks);
    byModel.set(key, model);
  }

  // Сначала самые дорогие возвраты; неизвестный результат — в конце.
  const models = [...byModel.values()]
    .sort(
      (a, b) =>
        (a.resultKopecks ?? Number.POSITIVE_INFINITY) -
          (b.resultKopecks ?? Number.POSITIVE_INFINITY) ||
        b.returnedUnits - a.returnedUnits ||
        a.marketplace.localeCompare(b.marketplace) ||
        a.offerId.localeCompare(b.offerId),
    )
    .slice(0, ANALYTICS_RETURN_MODELS_TOP);
  return { models, multiModelReturns };
}

/** Средняя фактическая строка карточки (`commission`, `delivery`) по заказам площадки. */
export function averageOf(
  orders: readonly IComputedOrder[],
  key: TOrderResultKey,
): IAnalyticsAverage {
  let count = 0;
  let sum = 0;
  let revenue: number | null = 0;
  for (const order of orders) {
    const amount = amountOf(order, key);
    if (!amount || amount.source !== 'actual' || amount.kopecks === null) continue;
    count += 1;
    sum += amount.kopecks;
    revenue = addStrict(revenue, amountOf(order, 'revenue')?.kopecks ?? null);
  }
  return {
    ordersCount: count,
    avgKopecks: count ? Math.round(sum / count) : null,
    shareOfRevenue: count ? ratio(sum, revenue) : null,
  };
}

/** Показатели одной площадки для сравнения. */
export function marketplaceDataOf(
  marketplace: TFinanceMarketplace,
  orders: readonly IComputedOrder[],
): IAnalyticsMarketplaceData {
  const own = orders.filter((o) => o.marketplace === marketplace && isShipped(o));
  let revenue: number | null = 0;
  let profit: number | null = 0;
  let unknownCount = 0;
  for (const order of own) {
    revenue = addStrict(revenue, amountOf(order, 'revenue')?.kopecks ?? null);
    const net = netOf(order);
    if (net === null) unknownCount += 1;
    profit = addStrict(profit, net);
  }
  return {
    marketplace,
    label: MARKETPLACE_LABEL[marketplace],
    insufficientData: false,
    ordersCount: own.length,
    revenueKopecks: revenue,
    profitKopecks: profit,
    unknownCount,
    margin: ratio(profit, revenue),
    commission: averageOf(own, 'commission'),
    logistics: averageOf(own, 'delivery'),
  };
}

/** Дни периода подряд, от первого к последнему. */
export function daysOf(period: IFinancePeriod): string[] {
  const days: string[] = [];
  for (let day = period.from; day <= period.to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/** Прибыль по дням оформления — каждой площадки отдельно, пустой день — 0 заказов. */
export function profitByDayOf(
  orders: readonly IComputedOrder[],
  marketplaces: readonly TFinanceMarketplace[],
  period: IFinancePeriod,
): IAnalyticsDay[] {
  const rows = new Map<string, IAnalyticsDay>();
  const days = daysOf(period);
  for (const marketplace of marketplaces) {
    for (const day of days) {
      rows.set(`${marketplace}|${day}`, {
        day,
        marketplace,
        ordersCount: 0,
        profitKopecks: 0,
        unknownCount: 0,
      });
    }
  }
  for (const order of orders) {
    const row = rows.get(`${order.marketplace}|${orderCreatedOn(order.lines)}`);
    if (!row) continue;
    const net = netOf(order);
    row.ordersCount += 1;
    if (net === null) row.unknownCount += 1;
    row.profitKopecks = addStrict(row.profitKopecks, net);
  }
  return [...rows.values()];
}

/**
 * Вся аналитика периода. `availability` — по каждой площадке: null — данные есть,
 * строка — причина `insufficientData`. Площадка без данных не участвует ни в
 * одном блоке, а в сравнении стоит с причиной.
 */
export function analyticsOf(
  orders: readonly IComputedOrder[],
  availability: TAnalyticsAvailability,
  period: IFinancePeriod,
): IAccountingAnalyticsSummary {
  const order = Object.keys(availability) as TFinanceMarketplace[];
  const open = order.filter((m) => availability[m] === null);
  const own = orders.filter((o) => open.includes(o.marketplace));
  return {
    products: productsOf(own),
    lossOrders: lossOrdersOf(own),
    returnModels: returnModelsOf(own),
    marketplaces: order.map((marketplace) =>
      availability[marketplace] === null
        ? marketplaceDataOf(marketplace, own)
        : {
            marketplace,
            label: MARKETPLACE_LABEL[marketplace],
            insufficientData: true,
            reason: availability[marketplace],
          },
    ),
    days: profitByDayOf(own, open, period),
  };
}
