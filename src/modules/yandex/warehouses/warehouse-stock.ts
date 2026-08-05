import type { IFbyStockSummary, TFbyStockType } from '../fby/fby-stock-report';
import type { IWarehouseInfo } from '../yandex-api.client';

import { FBY_STOCK_TYPES } from '../fby/fby-stock-report';

/**
 * Соединение «склад из списка Маркета» ↔ «остатки из отчёта».
 *
 * Общего идентификатора у этих двух источников НЕТ: `GET v2/warehouses` отдаёт
 * числовой `id`, а отчёт stocks-on-warehouses — только колонку `WAREHOUSE` с
 * названием. Значит соединяем по имени — и только ТОЧНО, после нормализации.
 * Никакого подстрочного матчинга: «Ростов-на-Дону-1» и «Ростов-на-Дону-2» —
 * разные площадки, и склеенные числа уехали бы не туда МОЛЧА, тогда как
 * несопоставленная строка видна на экране сама по себе.
 *
 * Этим он и отличается от `clusterOf` в fby-clusters: там подстрочные маркеры
 * географии, здесь точное равенство имён. Разные задачи; слить их значит
 * получить фаззи-джойн с чёрного хода.
 *
 * Модуль чистый (импорты только типовые плюс список типов остатков): ни сети,
 * ни Nest, ни разметки — приём fby-clusters.ts.
 */

/** Откуда взялась строка экрана — от этого зависит, что показывать в хвосте. */
export type TWarehouseRowOrigin = 'matched' | 'list-only' | 'report-only';

/** Строка экрана: склад (или имя из отчёта) вместе с его остатками. */
export interface IWarehouseStockRow {
  /** Нормализованное имя — ключ соединения. */
  key: string;
  /** Как показывать: имя из списка Маркета, иначе имя из отчёта. */
  name: string;
  /**
   * Идентификаторы складов списка с этим именем. Массив, потому что отчёт даёт
   * ОДИН набор чисел на имя, и разложить его по двум одноимённым складам нечем.
   * Одна строка на имя ⇒ каждая запись отчёта учтена ровно один раз, и сумма
   * строк равна общим итогам ПО ПОСТРОЕНИЮ, а не благодаря фильтрам.
   */
  ids: number[];
  /** Адрес первого склада списка с этим именем, если Маркет его вернул. */
  address?: string;
  /** Остатки по типам. `null` — отчёта нет вовсе; это НЕ нули. */
  totals: Record<TFbyStockType, number> | null;
  /** Сумма по всем типам — ключ сортировки и признак «пусто». */
  count: number;
  origin: TWarehouseRowOrigin;
}

/** Имя склада без названия — литерал наш, не данные Маркета. */
export const UNNAMED_WAREHOUSE = 'склад без названия';

/**
 * Ключ соединения. Регистр вниз, `ё`→`е` (живой разнобой — ср. маркеры
 * «толмачёво»/«толмачево» в fby-clusters), кавычки прочь, любое тире к дефису,
 * пробелы (включая NBSP) схлопнуть. Цифры и суффиксы НЕ трогаем: ими площадки
 * и различаются.
 */
export function warehouseKey(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function emptyTotals(): Record<TFbyStockType, number> {
  const totals = {} as Record<TFbyStockType, number>;
  for (const type of FBY_STOCK_TYPES) totals[type] = 0;
  return totals;
}

/** Сумма по всем типам остатков. */
export function stockTotal(totals: Readonly<Record<TFbyStockType, number>>): number {
  return FBY_STOCK_TYPES.reduce((sum, type) => sum + totals[type], 0);
}

/**
 * Строки экрана складов.
 *
 * Три случая живут в ОДНОМ списке, а не в трёх секциях: продавец спрашивает
 * «где мой товар», и склад, известный только отчёту, обязан стоять наверху
 * рядом с остальными непустыми, а не в примечании под экраном. Отличает его
 * отсутствие `ids`.
 *
 * Порядок: сперва непустые по убыванию количества (приём problemLines), затем
 * пустые по алфавиту. Пустой склад из СПИСКА остаётся — это настоящий склад
 * Маркета; пустая строка, известная только отчёту, выбрасывается: показывать
 * нечего и сумму она не меняет.
 */
export function joinWarehouseStock(
  warehouses: readonly IWarehouseInfo[],
  byWarehouse: IFbyStockSummary['byWarehouse'] | null,
): IWarehouseStockRow[] {
  const rows = new Map<string, IWarehouseStockRow>();

  for (const warehouse of warehouses) {
    const key = warehouseKey(warehouse.name);
    const row = rows.get(key);
    if (row) {
      row.ids.push(warehouse.id);
      row.address ??= warehouse.address;
      continue;
    }
    rows.set(key, {
      key,
      name: warehouse.name,
      ids: [warehouse.id],
      address: warehouse.address,
      // Отчёт — полная таблица SKU×склад, поэтому склад, которого в нём нет,
      // ПУСТ, а не «неизвестен». Нули ставим только когда отчёт вообще есть:
      // так `totals === null` значит ровно «отчёта нет», и экран не выдаёт
      // недоступность источника за подтверждённые нули.
      totals: byWarehouse ? emptyTotals() : null,
      count: 0,
      origin: 'list-only',
    });
  }

  for (const [name, totals] of Object.entries(byWarehouse ?? {})) {
    const key = warehouseKey(name);
    const count = stockTotal(totals);
    const row = rows.get(key);

    if (row) {
      row.totals = totals;
      row.count = count;
      row.origin = 'matched';
      continue;
    }

    // Пустой ключ — строки отчёта без колонки WAREHOUSE: парсер их намеренно не
    // выбрасывает, чтобы сумма по складам сходилась с общими итогами.
    if (count <= 0) continue;
    rows.set(key, {
      key,
      name: name.trim() || UNNAMED_WAREHOUSE,
      ids: [],
      totals,
      count,
      origin: 'report-only',
    });
  }

  return [...rows.values()].sort(
    (a, bRow) =>
      Number(a.count <= 0) - Number(bRow.count <= 0) ||
      bRow.count - a.count ||
      a.name.localeCompare(bRow.name, 'ru'),
  );
}
