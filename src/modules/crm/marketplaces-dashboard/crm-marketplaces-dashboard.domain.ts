import type { TFinanceMarketplace } from '../../../database/postgres/finance.schema';
import type { IFinancePeriod } from '../../finance/finance-period';
import type { IPnlCompareReport } from '../../finance/finance.service';
import type { IPnlSalesDay } from '../../finance/pnl-sales';
import type {
  ICrmCompareColumn,
  ICrmMarketplaceCompareView,
} from '../marketplace-compare/crm-marketplace-compare.domain';

import { DASHBOARD_MIN_MARKETPLACES } from '../../marketplaces/marketplace-connections.domain';
import { toCrmMarketplaceCompare } from '../marketplace-compare/crm-marketplace-compare.domain';

/**
 * Дашборд «Площадки» CRM (TASK-191) — доставка. Колонки — те же, что у «Сравнения
 * площадок» (`toCrmMarketplaceCompare` над теми же двумя `FinanceService.compare`),
 * поэтому KPI площадки совпадают с её колонкой сравнения до копейки. Ряд по дням —
 * `pnl.salesByDay` того же отчёта, что и «Аналитика продаж» площадки. Прибыли по дням
 * нет: в журнальном P&L её нет, своей формулы не заводим (решение
 * marketplaces_dashboard_profit_by_period) — прибыль и маржа только за период.
 */

export const MARKETPLACES_DASHBOARD_KIND = 'marketplaces-dashboard:summary';

export const DASHBOARD_NEEDS_SECOND_TEXT =
  'Дашборд сравнивает площадки — подключите вторую площадку в «Подключениях».';

export interface ICrmDashboardColumn extends ICrmCompareColumn {
  /** Выручка, заказы и штуки по дням (МСК); пусто, если у колонки нет чисел. */
  days: IPnlSalesDay[];
}

export interface ICrmMarketplacesDashboardView extends Omit<ICrmMarketplaceCompareView, 'columns'> {
  columns: ICrmDashboardColumn[];
}

/** Хватает ли площадок для дашборда — то же правило, что прячет раздел в `/auth/me`. */
export const isDashboardEnough = (marketplaces: readonly unknown[]): boolean =>
  marketplaces.length >= DASHBOARD_MIN_MARKETPLACES;

/** Колонки — по подключённым открытым площадкам `order`; дни — только у колонок с числами. */
export function toCrmMarketplacesDashboard(
  period: IFinancePeriod,
  previousPeriod: IFinancePeriod,
  order: readonly TFinanceMarketplace[],
  current: IPnlCompareReport,
  previous: IPnlCompareReport,
): ICrmMarketplacesDashboardView {
  const compare = toCrmMarketplaceCompare(period, previousPeriod, order, current, previous);
  const daysOf = (marketplace: TFinanceMarketplace): IPnlSalesDay[] => {
    const report = current.reports.find((entry) => entry.marketplace === marketplace)?.report;
    return (report?.pnl.salesByDay ?? []).map((day) => ({ ...day }));
  };
  return {
    ...compare,
    columns: compare.columns.map((column) => ({
      ...column,
      days: column.state === 'ok' ? daysOf(column.marketplace) : [],
    })),
  };
}
