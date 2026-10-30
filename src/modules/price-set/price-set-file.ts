/**
 * Файл цен «артикул | цена» (TASK-199) → строки для `priceSetPlanOf`.
 *
 * xlsx, xls или csv (UTF-8 с BOM либо windows-1251 — `shared/spreadsheet.ts`).
 * Столбцы ищутся по заголовку из словаря синонимов; заголовка нет — артикул в
 * первом столбце, цена во втором (самый частый файл «скопировал два столбца»).
 * Берётся первый лист, где нашлась хоть одна строка.
 *
 * Битая строка не роняет файл: она уходит в «пропущено» с номером строки —
 * продавец увидит её в превью и поправит, а остальные цены посчитаются. Это не
 * журнал денег, где пропуск занижает статью, а запись, которую продавец ещё
 * подтвердит глазами.
 *
 * Чистый модуль: Nest и базы не знает.
 */

import type { IPriceSetFileRow } from './price-set.domain';

import { normalizeHeader, readSpreadsheet, sheetRows } from '../../shared/spreadsheet';
import { parseNumber } from '../yandex/stocks/price-list.parser';

/** Заголовки столбцов (сравниваются после `normalizeHeader`). */
export const PRICE_FILE_SKU_HEADERS: readonly string[] = [
  'Артикул',
  'Ваш артикул',
  'Артикул продавца',
  'Ваш SKU',
  'SKU',
  'SKU продавца',
  'offerId',
  'offer_id',
  'Offer ID',
  'vendorCode',
  'Код товара',
];

export const PRICE_FILE_PRICE_HEADERS: readonly string[] = [
  'Цена',
  'Новая цена',
  'Цена продажи',
  'Цена для покупателя',
  'Price',
];

/** Сколько первых строк листа просматривать в поиске заголовка. */
const HEADER_SCAN_ROWS = 10;

export type TPriceFileErrorKind = 'unreadable' | 'empty';

export class PriceFileError extends Error {
  constructor(
    readonly kind: TPriceFileErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'PriceFileError';
  }
}

/** Строка, которую не взяли: номер — как видит продавец, с 1. */
export interface IPriceFileBadRow {
  row: number;
  sku: string | null;
  reason: 'no-sku' | 'bad-price';
}

export interface IPriceFileResult {
  /** Строки с артикулом; цена `NaN` не бывает — битые в `bad`. Дубли остаются — их решает план. */
  rows: (IPriceSetFileRow & { row: number })[];
  bad: IPriceFileBadRow[];
  sheet: string;
  /** Номер строки заголовка с 1; null — заголовка нет, столбцы A и B. */
  headerRow: number | null;
}

export const PRICE_FILE_BAD_TEXT: Readonly<Record<IPriceFileBadRow['reason'], string>> = {
  'no-sku': 'цена есть, а артикула нет',
  'bad-price': 'цена не число или не больше нуля',
};

export function parsePriceFile(buffer: Buffer, fileName: string): IPriceFileResult {
  let workbook: ReturnType<typeof readSpreadsheet>;
  try {
    workbook = readSpreadsheet(buffer, fileName);
  } catch (error) {
    throw new PriceFileError(
      'unreadable',
      `Не удалось прочитать файл: ${(error as Error).message}`,
    );
  }

  for (const sheet of workbook.SheetNames) {
    const data = sheetRows(workbook, sheet);
    const layout = layoutOf(data);
    const result: IPriceFileResult = { rows: [], bad: [], sheet, headerRow: layout.headerRow };
    for (let r = layout.firstRow; r < data.length; r++) {
      const cells = data[r] ?? [];
      const sku = cellText(cells[layout.sku]);
      const rawPrice = cells[layout.price];
      const hasPrice = cellText(rawPrice) !== null;
      if (sku === null) {
        if (hasPrice) result.bad.push({ row: r + 1, sku: null, reason: 'no-sku' });
        continue;
      }
      const price = hasPrice ? parseNumber(rawPrice) : null;
      if (price === null || price <= 0) {
        result.bad.push({ row: r + 1, sku, reason: 'bad-price' });
        continue;
      }
      result.rows.push({ row: r + 1, sku, price });
    }
    if (result.rows.length || result.bad.length) return result;
  }
  throw new PriceFileError('empty', 'В файле нет ни одной строки «артикул — цена».');
}

interface ILayout {
  sku: number;
  price: number;
  headerRow: number | null;
  firstRow: number;
}

/**
 * Где столбцы. Строка, где узнаны оба заголовка, — заголовок. Не нашлась — A и
 * B; первая строка с нечисловой ценой тогда считается заголовком без синонимов
 * («Наименование | Стоимость»), а не битой строкой.
 */
function layoutOf(data: unknown[][]): ILayout {
  const skuHeaders = new Set(PRICE_FILE_SKU_HEADERS.map(normalizeHeader));
  const priceHeaders = new Set(PRICE_FILE_PRICE_HEADERS.map(normalizeHeader));
  for (let r = 0; r < Math.min(data.length, HEADER_SCAN_ROWS); r++) {
    const cells = (data[r] ?? []).map(normalizeHeader);
    const sku = cells.findIndex((cell) => skuHeaders.has(cell));
    const price = cells.findIndex((cell) => priceHeaders.has(cell));
    if (sku >= 0 && price >= 0 && sku !== price) {
      return { sku, price, headerRow: r + 1, firstRow: r + 1 };
    }
  }
  const first = data.findIndex((cells) => (cells ?? []).some((cell) => cellText(cell) !== null));
  const looksLikeHeader = first >= 0 && parseNumber(data[first][1]) === null;
  return {
    sku: 0,
    price: 1,
    headerRow: looksLikeHeader ? first + 1 : null,
    firstRow: looksLikeHeader ? first + 1 : 0,
  };
}

/** Ячейка → текст без пробелов по краям; пусто — null. */
function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}
