import type { IProfitPlaceRow } from '../../yandex/reports/profit';
import type { ITopSkusView, TTopSkusScope } from '../../yandex/top-skus/top-skus.domain';
import type { ICrmPeriodEcho } from '../jobs/crm-period.domain';

import { periodTitle } from '../../yandex/reports/report-period';
import { TOP_SKUS_EMPTY_TEXT, TOP_SKUS_SCOPE_LABEL } from '../../yandex/top-skus/top-skus.domain';
import { periodEcho } from '../jobs/crm-period.domain';

/**
 * «🏆 Топ товаров» в CRM — вид ответа. Формул нет: строки — `topSkusOf` поверх того же
 * `ProfitService.build`, что кнопка бота (README crm «Топ товаров»).
 */

export const TOP_SKUS_KIND = 'top-skus:summary';

export interface ICrmTopSkuRow {
  sku: string;
  name: string;
  count: number;
  revenue: number;
  net: number;
  margin: number | null;
  returns: number;
  /** Разрезы по месту. */
  byRegion?: IProfitPlaceRow[];
  byCluster?: IProfitPlaceRow[];
}

export interface ICrmTopSkusView {
  period: ICrmPeriodEcho;
  periodTitle: string;
  scope: TTopSkusScope;
  scopeLabel: string;
  orders: number;
  revenue: number;
  net: number;
  /** ВСЕ товары периода, по убыванию продаж — без среза. */
  skus: ICrmTopSkuRow[];
  /** `null` — разрезы по месту закрыты (сборка без `places`). */
  byRegion: IProfitPlaceRow[] | null;
  byCluster: IProfitPlaceRow[] | null;
  unconfirmedOrders: number;
  emptyText: string;
}

export function toCrmTopSkusView(view: ITopSkusView, now: Date = new Date()): ICrmTopSkusView {
  return {
    period: periodEcho(view.period),
    periodTitle: periodTitle(view.period, now),
    scope: view.scope,
    scopeLabel: TOP_SKUS_SCOPE_LABEL[view.scope],
    orders: view.orders,
    revenue: view.revenue,
    net: view.net,
    skus: view.skus.map((row) => ({
      sku: row.sku,
      name: row.name,
      count: row.count,
      revenue: row.revenue,
      net: row.net,
      margin: row.margin,
      returns: row.returns,
      ...(row.byRegion ? { byRegion: row.byRegion, byCluster: row.byCluster ?? [] } : {}),
    })),
    byRegion: view.byRegion ?? null,
    byCluster: view.byCluster ?? null,
    unconfirmedOrders: view.unconfirmedOrders,
    emptyText: TOP_SKUS_EMPTY_TEXT,
  };
}
