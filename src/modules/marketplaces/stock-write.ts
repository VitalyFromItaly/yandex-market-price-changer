import type {
  IMarketplaceStockWriteResult,
  IStockWriteUpdate,
  IStockWriteWarehouse,
  TStockWriteTarget,
} from './marketplace-adapter';

/**
 * Общие правила записи остатков Ozon и WB (TASK-175) — чистые функции, без HTTP.
 * Сами запросы и их порядок — в сервисах записи площадок.
 */

/** Склад продавца глазами правила: `fbs` — пишется ли на него остаток FBS. */
export interface IStockWriteCandidate extends IStockWriteWarehouse {
  fbs: boolean;
}

/**
 * Склад записи (решение `stock_push_single_fbs_warehouse`). Считаются ВСЕ рабочие
 * склады продавца, не только FBS: остаток из прайса — весь товар продавца, и при
 * втором складе (FBS или DBS) запись того же числа в один из них удвоила бы
 * продаваемое. Один склад, но не FBS (DBS, тип неизвестен) — писать некуда.
 */
export function stockWriteTargetOf(warehouses: readonly IStockWriteCandidate[]): TStockWriteTarget {
  if (warehouses.length > 1) {
    return {
      kind: 'several',
      names: warehouses.map((warehouse) => warehouse.name || warehouse.id),
    };
  }
  const [only] = warehouses;
  if (!only?.fbs) return { kind: 'none' };
  return { kind: 'ok', warehouse: { id: only.id, name: only.name } };
}

/**
 * Последний барьер перед HTTP: отрицательное, дробное или нечисловое количество
 * отменяет запись целиком — как `writeInBatches` ЯМ. Частичная запись с дырой
 * хуже, чем никакой.
 */
export function assertStockCounts(updates: readonly IStockWriteUpdate[]): void {
  const bad = updates.find((update) => !Number.isInteger(update.count) || update.count < 0);
  if (bad) {
    throw new Error(
      `Остаток «${bad.sku}» = ${String(bad.count)}: не целое неотрицательное число — запись отменена целиком`,
    );
  }
}

/** Запись не ушла: env выключен или склад уже не тот, что в плане. */
export function skippedWrite(
  skipReason: IMarketplaceStockWriteResult['skipReason'],
): IMarketplaceStockWriteResult {
  return { written: 0, errors: [], skipped: [], skipReason };
}

/** Режет позиции на батчи. */
export function batchesOf<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/** Текст ошибки для отчёта: только сообщение, без стека и заголовков. */
export function writeErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
