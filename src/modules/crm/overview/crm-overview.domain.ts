import type { TMarketplace } from '../../../shared/marketplace';
import type { IUnconfirmedProfit } from '../../../shared/profit-confirmation';
import type { IFinancePeriod } from '../../finance/finance-period';
import type { TFinancePeriodStatus } from '../../finance/finance-period-status';
import type { IPnlReport } from '../../finance/finance.service';
import type { TOverviewServiceGroup } from '../../finance/service-groups';
import type { IReportPeriod } from '../../yandex/reports/report-period';
import type { ICrmPnlLevels } from '../finance/crm-finance.domain';

import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { serviceGroupsOf } from '../../finance/service-groups';
import { PERIOD } from '../../yandex/reports/report-period';
import { parseDayRange, pnlLevelsOf } from '../finance/crm-finance.domain';

/**
 * «Обзор» CRM (TASK-125, ТЗ п.1) — главная v2 уровня аккаунта.
 *
 * Деньги, заказы и штуки — из того же `FinanceService.build`, что «Финансы», и
 * уровни собирает та же `pnlLevelsOf`: карточки равны строкам «Прибыли» по
 * построению (решения `overview_account_section`, `overview_counts_from_journal`).
 * Остатки, товары в пути и отмены — из Маркета по магазинам кабинета: в журнале
 * их нет, и экран подписывает их как «из заказов Маркета». Под /ozon и /wb
 * (TASK-183) — то же по журналу, остаткам и заказам своей площадки.
 */

export const OVERVIEW_SUMMARY_KIND = 'overview:summary';
export const OVERVIEW_STOCKS_KIND = 'overview:stocks';
export const OVERVIEW_CANCELLED_KIND = 'overview:cancelled';

export const OVERVIEW_RANGE_INVALID_TEXT =
  'Период указан неверно: нужны даты начала и конца, не задом наперёд и не длиннее года.';

/** Текущий и прошлый период сводки — оба проверены одним разбором. */
export interface IOverviewRanges {
  current: IFinancePeriod;
  previous: IFinancePeriod;
}

export function parseOverviewRanges(params: Record<string, unknown>): IOverviewRanges | null {
  const current = parseDayRange(params.from, params.to);
  const previous = parseDayRange(params.prevFrom, params.prevTo);
  return current && previous ? { current, previous } : null;
}

// Группы услуг живут в finance (TASK-137): ими же группирует «Сравнение площадок».
export { OVERVIEW_SERVICE_GROUP } from '../../finance/service-groups';
export type { TOverviewServiceGroup };

export interface ICrmOverviewTotals {
  from: string;
  to: string;
  levels: ICrmPnlLevels;
  /** Платёж покупателя и субсидии — выручка до возвратов. */
  salesKopecks: number;
  /** Возвраты платежей и баллов — со знаком площадки (обычно < 0). */
  returnsKopecks: number;
  services: Record<TOverviewServiceGroup, number>;
  ordersCount: number;
  units: number;
  /** Выручка / заказы, копейки; null — заказов нет. */
  avgCheckKopecks: number | null;
}

export function overviewTotalsOf(report: IPnlReport): ICrmOverviewTotals {
  const { pnl } = report;
  const services = serviceGroupsOf(pnl);
  return {
    from: pnl.period.from,
    to: pnl.period.to,
    levels: pnlLevelsOf(report),
    salesKopecks: pnl.byArticle.sales.kopecks + pnl.byArticle.subsidies.kopecks,
    returnsKopecks: pnl.byArticle.returns.kopecks,
    services,
    ordersCount: pnl.ordersCount,
    units: pnl.units,
    avgCheckKopecks: pnl.ordersCount > 0 ? Math.round(pnl.revenueKopecks / pnl.ordersCount) : null,
  };
}

/**
 * Ответ `overview:summary`: без `operationIds` — раскрытие живёт в «Финансах».
 * Площадку kind добавляет эхом (TASK-183) — как и в двух других ответах.
 */
export interface ICrmOverviewSummaryView {
  current: ICrmOverviewTotals;
  previous: ICrmOverviewTotals;
  status: TFinancePeriodStatus;
  statusLabel: string;
  /** Признак движка (TASK-119): продажи без закупа — чистая завышена. */
  unconfirmed: IUnconfirmedProfit;
  taxIsDefault: boolean;
  receivable: { asOf: string; totalKopecks: number; operationCount: number };
}

export function toCrmOverviewSummary(
  current: IPnlReport,
  previous: IPnlReport,
  receivable: { asOf: string; totalKopecks: number; operationCount: number },
): ICrmOverviewSummaryView {
  return {
    current: overviewTotalsOf(current),
    previous: overviewTotalsOf(previous),
    status: current.status,
    statusLabel: current.statusLabel,
    unconfirmed: current.pnl.unconfirmed,
    taxIsDefault: current.taxIsDefault,
    receivable: {
      asOf: receivable.asOf,
      totalKopecks: receivable.totalKopecks,
      operationCount: receivable.operationCount,
    },
  };
}

/** Магазин, по которому срез не собрался: имя и причина текстом, а не ноль. */
export interface ICrmOverviewStoreProblem {
  storeName: string;
  problem: string;
}

export interface ICrmOverviewStocksView {
  marketplace: TMarketplace;
  takenAt: string;
  /** Σ остаток × текущий закуп, копейки, — только позиции с закупом. */
  stockValueKopecks: number;
  stockUnits: number;
  /** Позиций и штук без закупа: их стоимость не учтена, а не равна нулю. */
  withoutCost: { skus: number; units: number };
  /**
   * null — отчёт «Едет до клиента» закрыт фичей (ЯМ) или заказы площадки не
   * прочитаны. `salesKopecks` null — у заказа Ozon/WB неизвестна цена.
   */
  inTransit: { orders: number; units: number; salesKopecks: number | null } | null;
  stores: number;
  problems: ICrmOverviewStoreProblem[];
}

/**
 * Стоимость остатков одного магазина по текущему закупу (решение
 * `overview_stock_value_current_cost`). `costs` — рубли за штуку после скидки
 * бренда (`applyDiscounts`); копейки округляются на позицию, не на сумму.
 */
export function stockValueOf(
  stocks: Record<string, number>,
  costs: ReadonlyMap<string, number>,
): { kopecks: number; units: number; withoutCost: { skus: number; units: number } } {
  let kopecks = 0;
  let units = 0;
  const withoutCost = { skus: 0, units: 0 };
  for (const [sku, count] of Object.entries(stocks)) {
    if (!(count > 0)) continue;
    units += count;
    const cost = costs.get(sku);
    if (cost === undefined || !Number.isFinite(cost)) {
      withoutCost.skus += 1;
      withoutCost.units += count;
      continue;
    }
    kopecks += Math.round(cost * 100) * count;
  }
  return { kopecks, units, withoutCost };
}

export const CANCELLED_RANGE_UNSUPPORTED_TEXT =
  'Отмены за такой период Маркет по заказам не отдаёт: доступны сегодня, отдельный день и месяц с 1 числа по сегодня.';

/** Текст ЯМ — как был; Ozon/WB — без «Маркета»: периоды заказов те же (`cancelledPeriodOf`). */
export function cancelledRangeUnsupportedText(marketplace: TMarketplace): string {
  if (marketplace === 'ym') return CANCELLED_RANGE_UNSUPPORTED_TEXT;
  return `Отмены ${MARKETPLACE_LABEL[marketplace]} считаются за сегодня, отдельный день и месяц с 1 числа по сегодня.`;
}

export const CANCELLED_NO_ORDERS_TEXT = (marketplace: TMarketplace) =>
  `Заказы ${MARKETPLACE_LABEL[marketplace]} пока не читаются — отмены не посчитаны.`;

export interface ICrmOverviewCancelledView {
  marketplace: TMarketplace;
  from: string;
  to: string;
  /** null — за такой период отмены не считаются, причина в `note`. */
  count: number | null;
  note: string | null;
  stores: number;
  problems: ICrmOverviewStoreProblem[];
}

/**
 * Период отчётов о заказах для диапазона «Обзора». Отчёты знают периоды бота —
 * сегодня, день, месяц с 1 числа, — а расширять их ради главной значит править
 * общий код отчётов (довод `pnl_flat_current_month_only`). Остальное — null.
 */
export function cancelledPeriodOf(range: IFinancePeriod, today: string): IReportPeriod | null {
  if (range.from === range.to) {
    if (range.from === today) return { key: PERIOD.TODAY };
    const [year, month, day] = range.from.split('-').map(Number);
    return { key: PERIOD.DAY, day: { year, month, day } };
  }
  if (range.to === today && range.from === `${today.slice(0, 8)}01`) return { key: PERIOD.MONTH };
  return null;
}
