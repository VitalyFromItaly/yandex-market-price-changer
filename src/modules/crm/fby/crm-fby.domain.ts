import type { IFbyStockSummary, TFbyStockType } from '../../yandex/fby/fby-stock-report';
import type { IFbyOverviewReport } from '../../yandex/fby/fby.service';
import type { IFbySupplyRequest } from '../../yandex/yandex-api.client';

import {
  clusterTotals,
  fbyStockUnavailableLine,
  formatSupplyDate,
  orderRequests,
  requestStatusLabel,
  requestTypeLabel,
  REQUESTS_UNAVAILABLE_TEXT,
  splitSupplies,
  STOCK_HINT,
  STOCK_SHORT_LABEL,
  SUPPLIES_UNAVAILABLE_TEXT,
  supplyStatusLabel,
} from '../../yandex/fby/fby-message';
import { FBY_STOCK_TYPES } from '../../yandex/fby/fby-stock-report';
import { moscowStamp } from '../../yandex/reports/moscow-day';
import { SUPPLY_STATUS } from '../../yandex/reports/report-status-map';
import { withoutIcon } from '../jobs/crm-jobs.domain';

/**
 * «FBY» в CRM — чистая часть: вид ответа фоновой задачи. Данные — из
 * `FbyService.buildData` (тот же сбор, что у бота), подписи, порядок и суммы
 * кластеров — из fby-message; своей копии правил нет.
 */

/** Имя kind-а фоновой задачи. Параметров нет — срез «сейчас». */
export const FBY_JOB_KIND = 'fby:overview';

export type TCrmStockTotals = Record<TFbyStockType, number>;

export interface ICrmFbyCluster {
  title: string;
  totals: TCrmStockTotals;
  warehouses: { name: string; totals: TCrmStockTotals }[];
}

export interface ICrmFbyProblem {
  sku: string;
  name: string;
  defect: number;
  expired: number;
  utilization: number;
}

export interface ICrmFbyRequest {
  id: string;
  typeLabel: string;
  statusLabel: string;
  /** Готово забрать — действие продавца нужно сейчас. */
  ready: boolean;
  defectCount: number;
  targetName: string | null;
}

export interface ICrmFbySupply {
  id: string;
  statusLabel: string;
  /** Дата поставки DD-MM-YYYY; null — не пришла или битая. */
  date: string | null;
  targetName: string | null;
  transitName: string | null;
  planCount: number;
  factCount: number;
}

/**
 * Поставки — тройная семантика `IFbyOverviewData.supplies` без `undefined`,
 * которого в JSON нет: off — фича выключена, секции нет; error — сбой.
 */
export type TCrmFbySupplies =
  | { state: 'off' }
  | { state: 'error'; text: string }
  | { state: 'ok'; rows: ICrmFbySupply[]; terminal: number };

export interface ICrmFbyView {
  takenAt: string;
  /** На какой момент сняты остатки (мемо до 60 с); null — остатков нет. */
  stockTakenAt: string | null;
  /** Типы остатков в порядке бота с короткими подписями. */
  stockTypes: { type: TFbyStockType; label: string }[];
  /** Расшифровка «резерв/карантин/утиль» — та же строка, что у бота. */
  stockHint: string;
  /** Почему остатков нет — текст бота без значка; null — остатки есть. */
  stockProblem: string | null;
  stock: {
    totals: TCrmStockTotals;
    clusters: ICrmFbyCluster[];
    problems: ICrmFbyProblem[];
  } | null;
  requests: ICrmFbyRequest[] | null;
  requestsProblem: string | null;
  supplies: TCrmFbySupplies;
  inTransit: number | null;
  returning: number | null;
  file: { filename: string; rows: number; truncated: number } | null;
}

function isReady(status: string): boolean {
  return (
    status === SUPPLY_STATUS.READY_TO_WITHDRAW || status === SUPPLY_STATUS.READY_FOR_UTILIZATION
  );
}

function toRequest(request: IFbySupplyRequest): ICrmFbyRequest {
  return {
    id: request.id,
    typeLabel: requestTypeLabel(request.type),
    statusLabel: requestStatusLabel(request.status),
    ready: isReady(request.status),
    defectCount: request.defectCount,
    targetName: request.targetName ?? null,
  };
}

function toSupply(supply: IFbySupplyRequest): ICrmFbySupply {
  return {
    id: supply.id,
    statusLabel: supplyStatusLabel(supply.status),
    date: (supply.requestedDate && formatSupplyDate(supply.requestedDate)) || null,
    targetName: supply.targetName ?? null,
    transitName: supply.transitName ?? null,
    planCount: supply.planCount,
    factCount: supply.factCount,
  };
}

function toSupplies(supplies: IFbySupplyRequest[] | null | undefined): TCrmFbySupplies {
  if (supplies === undefined) return { state: 'off' };
  if (supplies === null) return { state: 'error', text: withoutIcon(SUPPLIES_UNAVAILABLE_TEXT) };
  const { active, terminal } = splitSupplies(supplies);
  return { state: 'ok', rows: active.map(toSupply), terminal };
}

function toStock(summary: IFbyStockSummary): NonNullable<ICrmFbyView['stock']> {
  return {
    totals: summary.totals,
    // Склад без колонки WAREHOUSE — та же подпись, что у бота.
    clusters: clusterTotals(summary.byWarehouse).map((group) => ({
      title: group.title || 'склад без названия',
      totals: group.totals,
      warehouses: group.warehouses,
    })),
    problems: summary.problems.map(({ sku, name, defect, expired, utilization }) => ({
      sku,
      name,
      defect,
      expired,
      utilization,
    })),
  };
}

/** Вид ответа. Никогда не null (довод `useReportJob`): каждый блок деградирует сам. */
export function toCrmFbyView(report: IFbyOverviewReport): ICrmFbyView {
  const { data, workbook } = report;
  return {
    takenAt: moscowStamp(report.takenAt),
    stockTakenAt: report.stockTakenAt ? moscowStamp(report.stockTakenAt) : null,
    stockTypes: FBY_STOCK_TYPES.map((type) => ({ type, label: STOCK_SHORT_LABEL[type] })),
    stockHint: withoutIcon(STOCK_HINT),
    stockProblem: data.stock ? null : withoutIcon(fbyStockUnavailableLine(data.stockError)),
    stock: data.stock ? toStock(data.stock) : null,
    requests: data.requests ? orderRequests(data.requests).map(toRequest) : null,
    requestsProblem: data.requests ? null : withoutIcon(REQUESTS_UNAVAILABLE_TEXT),
    supplies: toSupplies(data.supplies),
    inTransit: data.inTransit,
    returning: data.returning,
    file: workbook
      ? { filename: workbook.filename, rows: workbook.rows, truncated: workbook.truncated }
      : null,
  };
}
