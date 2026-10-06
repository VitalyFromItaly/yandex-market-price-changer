import type { TFbyStockType } from '../../yandex/fby/fby-stock-report';
import type { TWarehouseRowOrigin } from '../../yandex/warehouses/warehouse-stock';
import type { IWarehousesScreenData } from '../../yandex/warehouses/warehouses-message';

import { fbyStockUnavailableLine, STOCK_SHORT_LABEL } from '../../yandex/fby/fby-message';
import { FBY_STOCK_TYPES } from '../../yandex/fby/fby-stock-report';
import { moscowStamp } from '../../yandex/reports/moscow-day';
import { joinWarehouseStock } from '../../yandex/warehouses/warehouse-stock';
import {
  FBY_HINT,
  NOT_IN_LIST,
  STORE_HINT,
  WAREHOUSES_EMPTY_TEXT,
  warehouseRowsSum,
} from '../../yandex/warehouses/warehouses-message';
import { withoutIcon } from '../jobs/crm-jobs.domain';

/**
 * «Склады» в CRM — чистая часть: вид ответа фоновой задачи. Соединение списка
 * со стоком — `joinWarehouseStock`, «Итого» — `warehouseRowsSum` по показанным
 * строкам: те же функции, что у экрана бота.
 */

/** Имя kind-а фоновой задачи. Параметров нет — срез «сейчас». */
export const WAREHOUSES_JOB_KIND = 'warehouses:overview';

export interface ICrmWarehouseRow {
  /** Нормализованное имя — ключ строки. */
  key: string;
  name: string;
  address: string | null;
  /** id складов Маркета (одноимённые схлопнуты); пусто — склада нет в списке. */
  ids: number[];
  origin: TWarehouseRowOrigin;
  /** null — отчёта остатков нет вовсе (не «пусто»). */
  totals: Record<TFbyStockType, number> | null;
  count: number;
}

export interface ICrmStoreWarehouse {
  id: number;
  name: string;
  address: string | null;
  express: boolean;
  groupName: string | null;
}

export interface ICrmWarehousesView {
  takenAt: string;
  stockTakenAt: string | null;
  stockTypes: { type: TFbyStockType; label: string }[];
  /** Почему остатков нет — текст бота без значка; null — остатки есть. */
  stockProblem: string | null;
  fbyHint: string;
  storeHint: string;
  /** Подпись склада из отчёта, которого нет в списке Маркета. */
  notInListLabel: string;
  fby: ICrmWarehouseRow[];
  /** Сумма по строкам `fby`; null — отчёта нет. */
  sum: Record<TFbyStockType, number> | null;
  store: ICrmStoreWarehouse[];
  /** Складов нет вовсе — текст бота; null — есть. */
  emptyText: string | null;
  /** xlsx остатков (книга «FBY»); null — отчёта остатков нет. */
  file: { filename: string; rows: number; truncated: number } | null;
}

/** Вид ответа. Никогда не null (довод `useReportJob`). */
export function toCrmWarehousesView(
  data: IWarehousesScreenData,
  now: Date,
  workbook: { filename: string; rows: number; truncated: number } | null = null,
): ICrmWarehousesView {
  const rows = joinWarehouseStock(data.overview.fulfillment, data.byWarehouse);
  const empty = rows.length + data.overview.store.length === 0;
  return {
    takenAt: moscowStamp(now),
    stockTakenAt: data.stockTakenAt ? moscowStamp(data.stockTakenAt) : null,
    stockTypes: FBY_STOCK_TYPES.map((type) => ({ type, label: STOCK_SHORT_LABEL[type] })),
    stockProblem: data.byWarehouse ? null : withoutIcon(fbyStockUnavailableLine(data.stockError)),
    fbyHint: FBY_HINT,
    storeHint: STORE_HINT,
    notInListLabel: withoutIcon(NOT_IN_LIST),
    fby: rows.map((row) => ({
      key: row.key,
      name: row.name,
      address: row.address ?? null,
      ids: row.ids,
      origin: row.origin,
      totals: row.totals,
      count: row.count,
    })),
    sum: data.byWarehouse ? warehouseRowsSum(rows) : null,
    store: data.overview.store.map((warehouse) => ({
      id: warehouse.id,
      name: warehouse.name,
      address: warehouse.address ?? null,
      express: warehouse.express === true,
      groupName: warehouse.groupName ?? null,
    })),
    emptyText: empty ? WAREHOUSES_EMPTY_TEXT : null,
    // Только метаданные: сам буфер уходит отдельным файлом задачи, не в JSON.
    file: workbook
      ? { filename: workbook.filename, rows: workbook.rows, truncated: workbook.truncated }
      : null,
  };
}
