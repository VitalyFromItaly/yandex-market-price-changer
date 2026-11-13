import type {
  AccountingDashboardResponse,
  AccountingDashboardView,
  DashboardBasis,
  DashboardBlockKey,
  DashboardBlockResponse,
  DashboardCell,
  DashboardLineTotalResponse,
  DashboardRow,
  OrderProfitReason,
} from '../accounting.domain';

import { ORDER_REASON_LABEL } from './mapAccountingOrderCard.accounting';

import { rangeLabel } from '@/shared/period';
import { formatDay, formatKopecks, formatSavedAt } from '@/shared/utils';

/** Неизвестное — словом, никогда «0 ₽» (неизвестная себестоимость не ноль). */
export const DASHBOARD_UNKNOWN_LABEL = 'Неизвестно';
/** Строка без единой суммы в периоде. */
export const DASHBOARD_EMPTY_LABEL = '—';

const BASES: Record<DashboardBasis, true> = { sale: true, accrual: true, cash: true };
const isBasis = (key: string): key is DashboardBasis => key in BASES;

const blockKey = (block: DashboardBlockResponse): DashboardBlockKey => block.marketplace ?? 'all';

/** Причина неизвестной суммы словами; код без подписи — как есть, «unknown» — без пояснения. */
export function dashboardReasonText(reason: string | null): string | null {
  if (reason === null || reason === 'unknown') return null;
  return ORDER_REASON_LABEL[reason as OrderProfitReason] ?? reason;
}

function lineCell(
  block: DashboardBlockResponse,
  total: DashboardLineTotalResponse | undefined,
): DashboardCell {
  const key = blockKey(block);
  if (!total) {
    return { text: DASHBOARD_EMPTY_LABEL, state: 'fact', note: null, line: null, block: key };
  }
  if (total.kopecks === null) {
    return {
      text: DASHBOARD_UNKNOWN_LABEL,
      state: 'unknown',
      note: dashboardReasonText(total.unknownReason),
      line: total.line,
      block: key,
    };
  }
  if (total.count === 0) {
    return { text: DASHBOARD_EMPTY_LABEL, state: 'fact', note: null, line: null, block: key };
  }
  return {
    text: formatKopecks(total.kopecks),
    state: total.expectedKopecks === 0 ? 'fact' : 'estimate',
    note:
      total.expectedKopecks === 0
        ? null
        : `Из них ожидается ${formatKopecks(total.expectedKopecks)}`,
    line: total.line,
    block: key,
  } satisfies DashboardCell;
}

/** Итог блока: оценка, если в блоке есть ожидаемое; неизвестно — если сервер дал null. */
function totalCell(
  block: DashboardBlockResponse,
  kopecks: number | null,
  text: (k: number) => string = formatKopecks,
): DashboardCell {
  const key = blockKey(block);
  if (kopecks === null) {
    const unknown = block.lines.some((l) => l.kopecks === null);
    return {
      text: unknown ? DASHBOARD_UNKNOWN_LABEL : DASHBOARD_EMPTY_LABEL,
      state: unknown ? 'unknown' : 'fact',
      note: unknown ? 'Есть строки с неизвестной суммой' : null,
      line: null,
      block: key,
    };
  }
  const estimate = block.lines.some((l) => l.expectedKopecks !== 0);
  return {
    text: text(kopecks),
    state: estimate ? 'estimate' : 'fact',
    note: estimate ? 'Включает ожидаемые суммы' : null,
    line: null,
    block: key,
  };
}

/** Деньги «к выплате / получено»: null — не делится по фильтру или неизвестно, не ноль. */
function moneyCell(block: DashboardBlockResponse, kopecks: number | null): DashboardCell {
  return {
    text: kopecks === null ? DASHBOARD_EMPTY_LABEL : formatKopecks(kopecks),
    state: 'fact',
    note: null,
    line: null,
    block: blockKey(block),
  };
}

const formatPercent = (value: number): string => `${value.toLocaleString('ru-RU')} %`;

/**
 * Панель «Финучёта» (TASK-231): колонки — площадки и «Все площадки», только если
 * сервер её собрал (сами площадки в одно число не складываются); строки — в порядке
 * сервера, названия уже по базису. Все числа — с сервера, здесь только подписи.
 */
export function mapAccountingDashboard(data: AccountingDashboardResponse): AccountingDashboardView {
  const blocks = [...data.totals.byMarketplace, ...(data.totals.all ? [data.totals.all] : [])];
  const template = blocks[0]?.lines ?? [];
  const hasAll = data.totals.all !== null;

  const lineRows: DashboardRow[] = template.map((t) => ({
    key: t.line,
    title: t.title,
    hint: null,
    cells: blocks.map((b) =>
      lineCell(
        b,
        b.lines.find((l) => l.line === t.line),
      ),
    ),
    total: false,
  }));

  const payableTitle = data.payableAsOf
    ? `К выплате на ${formatDay(data.payableAsOf)}`
    : 'К выплате';

  const totalRows: DashboardRow[] = [
    {
      key: 'gross',
      title: 'Валовая прибыль',
      hint: 'Выручка, возвраты и себестоимость',
      cells: blocks.map((b) => totalCell(b, b.grossKopecks)),
      total: true,
    },
    {
      key: 'net',
      title: 'Чистая прибыль',
      hint: 'Сумма всех строк',
      cells: blocks.map((b) => totalCell(b, b.netKopecks)),
      total: true,
    },
    {
      key: 'margin',
      title: 'Маржа',
      hint: 'Чистая прибыль к выручке за вычетом возвратов',
      cells: blocks.map((b) => totalCell(b, b.marginPercent, formatPercent)),
      total: false,
    },
    {
      key: 'payable',
      title: payableTitle,
      hint: 'Начислено площадкой, но ещё не выплачено — на этот день, а не на конец периода',
      cells: blocks.map((b) => moneyCell(b, b.payableKopecks)),
      total: false,
    },
    {
      key: 'received',
      title: 'Получено за период',
      hint: 'Выплаты площадок в периоде',
      cells: blocks.map((b) => moneyCell(b, b.receivedKopecks)),
      total: false,
    },
  ];

  const rows = [...lineRows, ...totalRows];
  const cells = rows.flatMap((r) => r.cells);
  const accountLevelNote = hasAll
    ? 'Без налога, закупа и общих расходов — они в «Все площадки»'
    : 'Без налога, закупа и общих расходов';
  const asOf = data.sync.asOf ? formatSavedAt(data.sync.asOf) : null;

  return {
    basisTitle: data.basisTitle,
    basisHint: data.basisHint,
    periodLabel: rangeLabel(data.period),
    columns: blocks.map((b) => ({
      block: blockKey(b),
      label: b.label,
      note: b.marketplace !== null && b.excludesAccountLevel ? accountLevelNote : null,
    })),
    rows,
    filterNote: data.filterNote,
    freshnessLabel: asOf ? `Журнал обновлён ${asOf}` : 'Журнал ещё не загружался',
    freshness: data.sync.marketplaces.map((m) => ({
      marketplace: m.marketplace,
      label: m.label,
      text: (m.lastSuccessAt && formatSavedAt(m.lastSuccessAt)) || 'ещё не загружался',
    })),
    basisOptions: data.basisOptions
      .filter((o) => isBasis(o.key))
      .map((o) => ({ value: o.key as DashboardBasis, label: o.label })),
    marketplaceOptions: data.marketplaceOptions.map((o) => ({
      value: o.marketplace as string,
      label: o.label,
    })),
    brandOptions: data.brandOptions,
    hasEstimate: cells.some((c) => c.state === 'estimate'),
    hasUnknown: cells.some((c) => c.state === 'unknown'),
  };
}
