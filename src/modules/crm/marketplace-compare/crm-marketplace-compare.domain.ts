import type { TFinanceMarketplace } from '../../../database/postgres/finance.schema';
import type { IFinancePeriod } from '../../finance/finance-period';
import type { TFinancePeriodStatus } from '../../finance/finance-period-status';
import type { IPnlCompareReport, IPnlReport } from '../../finance/finance.service';
import type {
  ICompareConclusion,
  ICompareEntry,
  ICompareMetrics,
  ISchemeTotal,
} from '../../finance/marketplace-compare';

import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import {
  COMPARE_OPEX_NOTE,
  COMPARE_OPEX_UNSHARED_NOTE,
  COMPARE_TAX_NOTE,
  COMPARE_UNVERIFIED_NOTE,
  compareMetricsOf,
  conclusionsOf,
  schemeTotalsOf,
} from '../../finance/marketplace-compare';
import { financeMarketplaceClosedText } from '../finance/crm-finance.domain';

/**
 * «Сравнение площадок» CRM (TASK-137) — доставка. Числа и выводы считает лист
 * `finance/marketplace-compare.ts` над `FinanceService.compare`; здесь только
 * состояние колонки и перечисление полей ответа.
 */

export const MARKETPLACE_COMPARE_KIND = 'marketplace-compare:summary';

export const MARKETPLACE_COMPARE_RANGE_INVALID_TEXT =
  'Период указан неверно: нужны даты начала и конца, не задом наперёд и не длиннее года.';

export const COMPARE_NO_JOURNAL_TEXT =
  'Журнал площадки за этот период не загружен — сравнивать нечего.';

/**
 * Колонка площадки. `closed` — фича площадки закрыта, журнал не читался вовсе;
 * `no-journal` — ни один месяц периода не загружен. Обе — без чисел: ноль
 * читался бы как «площадка ничего не заработала».
 */
export type TCompareColumnState = 'ok' | 'closed' | 'no-journal';

export interface ICrmCompareColumn {
  marketplace: TFinanceMarketplace;
  label: string;
  state: TCompareColumnState;
  /** Почему чисел нет; null у `ok`. */
  reason: string | null;
  status: TFinancePeriodStatus | null;
  statusLabel: string | null;
  /** false — период «не проверен»: сравнение подписано (у Ozon/WB — всегда). */
  verified: boolean;
  metrics: ICompareMetrics | null;
  /** null — журнал прошлого периода не загружен. */
  previous: ICompareMetrics | null;
  schemes: ISchemeTotal[];
}

export interface ICrmMarketplaceCompareView {
  period: IFinancePeriod;
  previousPeriod: IFinancePeriod;
  columns: ICrmCompareColumn[];
  conclusions: ICompareConclusion[];
  /** Правила учёта сравнения — экран печатает их под шапкой. */
  notes: string[];
  operatingExpensesKopecks: number;
  taxIsDefault: boolean;
}

/** Журнал загружен хотя бы за один месяц периода. */
export const hasJournal = (report: IPnlReport) =>
  report.months.some((month) => month.status !== null);

function metricsCopy(metrics: ICompareMetrics): ICompareMetrics {
  return { ...metrics, services: { ...metrics.services } };
}

/**
 * Колонки в порядке `order` (все площадки): закрытые — без запроса, открытые —
 * из двух `compare`. Выводы — только по колонкам с журналом.
 */
export function toCrmMarketplaceCompare(
  period: IFinancePeriod,
  previousPeriod: IFinancePeriod,
  order: readonly TFinanceMarketplace[],
  current: IPnlCompareReport,
  previous: IPnlCompareReport,
): ICrmMarketplaceCompareView {
  const reportOf = (compare: IPnlCompareReport, marketplace: TFinanceMarketplace) =>
    compare.reports.find((entry) => entry.marketplace === marketplace)?.report ?? null;

  const entries: ICompareEntry[] = [];
  const columns = order.map((marketplace): ICrmCompareColumn => {
    const base = { marketplace, label: MARKETPLACE_LABEL[marketplace], schemes: [] };
    const report = reportOf(current, marketplace);
    if (!report) {
      return {
        ...base,
        state: 'closed',
        reason: financeMarketplaceClosedText(marketplace),
        status: null,
        statusLabel: null,
        verified: false,
        metrics: null,
        previous: null,
      };
    }
    if (!hasJournal(report)) {
      return {
        ...base,
        state: 'no-journal',
        reason: COMPARE_NO_JOURNAL_TEXT,
        status: report.status,
        statusLabel: report.statusLabel,
        verified: false,
        metrics: null,
        previous: null,
      };
    }
    const before = reportOf(previous, marketplace);
    const prevPnl = before && hasJournal(before) ? before.pnl : null;
    entries.push({ marketplace, current: report.pnl, previous: prevPnl });
    return {
      ...base,
      state: 'ok',
      reason: null,
      status: report.status,
      statusLabel: report.statusLabel,
      verified: report.status === 'verified',
      metrics: metricsCopy(compareMetricsOf(report.pnl)),
      previous: prevPnl ? metricsCopy(compareMetricsOf(prevPnl)) : null,
      schemes: schemeTotalsOf(marketplace, report.pnl).map((total) => ({ ...total })),
    };
  });

  const notes = [
    COMPARE_TAX_NOTE,
    current.opexShared ? COMPARE_OPEX_NOTE : COMPARE_OPEX_UNSHARED_NOTE,
  ];
  if (columns.some((column) => column.state === 'ok' && !column.verified)) {
    notes.push(COMPARE_UNVERIFIED_NOTE);
  }

  return {
    period: { from: period.from, to: period.to },
    previousPeriod: { from: previousPeriod.from, to: previousPeriod.to },
    columns,
    conclusions: conclusionsOf(entries),
    notes,
    operatingExpensesKopecks: current.operatingExpensesKopecks,
    taxIsDefault: current.taxIsDefault,
  };
}
