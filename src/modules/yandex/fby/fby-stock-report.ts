import { inflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';

/**
 * Разбор отчёта «Остатки на складах» (FBY).
 *
 * Почему так, а не через offers/stocks. Синхронный getStocks для FBY-кампании
 * на боевом отдаёт ПУСТЫЕ остатки; единственный источник остатков по типам —
 * асинхронный отчёт stocks-on-warehouses. Его формат CSV приходит ZIP-архивом с
 * единственным файлом stocks_on_warehouses.csv (плоская таблица SKU×склад).
 *
 * Модуль ЧИСТЫЙ: на вход — буфер скачанного архива, на выход — агрегат. Ни сети,
 * ни Nest, ни telegraf — поэтому проверяется обычным юнит-тестом на реальном
 * образце.
 *
 * ZIP распаковываем ВСТРОЕННЫМ zlib (без внешней зависимости): у отчёта одна
 * запись, deflate; читаем central directory, затем inflateRawSync. SheetJS сам
 * ZIP-с-CSV не читает («Unsupported ZIP file»), но отлично парсит уже
 * распакованный CSV-текст — им и берём кавычки/запятые в названиях товаров.
 */

/** Типы остатков FBY. Совпадают с WarehouseStockType Partner API. */
export type TFbyStockType =
  | 'AVAILABLE'
  | 'FIT'
  | 'FREEZE'
  | 'QUARANTINE'
  | 'DEFECT'
  | 'EXPIRED'
  | 'UTILIZATION';

/** Порядок типов на экране: сперва «живые», затем проблемные. */
export const FBY_STOCK_TYPES: readonly TFbyStockType[] = [
  'AVAILABLE',
  'FIT',
  'FREEZE',
  'QUARANTINE',
  'DEFECT',
  'EXPIRED',
  'UTILIZATION',
];

/**
 * Колонка CSV → тип остатка. Названия колонок — латиницей в CSV-варианте отчёта
 * (в xlsx-варианте они русские, но тот отдаёт шапку без данных и не годится).
 */
const COLUMN_TO_TYPE: Readonly<Record<string, TFbyStockType>> = {
  AVAILABLE_FOR_ORDER: 'AVAILABLE',
  VALID: 'FIT',
  RESERVED: 'FREEZE',
  QUARANTINE: 'QUARANTINE',
  DEFECT: 'DEFECT',
  EXPIRED: 'EXPIRED',
  UTILIZATION: 'UTILIZATION',
};

/** Типы, попадающие в «проблемные позиции». */
export const PROBLEM_TYPES: readonly TFbyStockType[] = ['DEFECT', 'EXPIRED', 'UTILIZATION'];

/** Одна проблемная позиция — сумма по складам одного SKU. */
export interface IFbyProblemSku {
  sku: string;
  name: string;
  defect: number;
  expired: number;
  utilization: number;
}

/** Агрегат отчёта: итоги по типам и проблемные позиции. */
export interface IFbyStockSummary {
  totals: Record<TFbyStockType, number>;
  problems: IFbyProblemSku[];
}

/** Итог одной проблемной позиции — для сортировки и порога «в файл». */
export function problemTotal(p: IFbyProblemSku): number {
  return p.defect + p.expired + p.utilization;
}

/** Разбор скачанного архива отчёта: распаковка + разбор CSV. */
export function parseFbyStockReport(zipBuffer: Buffer): IFbyStockSummary {
  return parseFbyStockCsv(unzipSingleEntry(zipBuffer));
}

/**
 * Разбор уже распакованного CSV-текста отчёта. Вынесен отдельно от распаковки:
 * агрегация — это вся содержательная логика, и её проверяет юнит-тест на
 * инлайновом CSV, не собирая ZIP. Распаковка проверена на реальном файле
 * Маркета живым прогоном.
 */
export function parseFbyStockCsv(csv: string): IFbyStockSummary {
  const workbook = XLSX.read(csv, { type: 'string', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const totals = emptyTotals();
  const byProblemSku = new Map<string, IFbyProblemSku>();

  for (const row of rows) {
    for (const [column, type] of Object.entries(COLUMN_TO_TYPE)) {
      totals[type] += numeric(row[column]);
    }

    const defect = numeric(row.DEFECT);
    const expired = numeric(row.EXPIRED);
    const utilization = numeric(row.UTILIZATION);
    if (defect + expired + utilization <= 0) continue;

    const sku = String(row.SHOP_SKU ?? '').trim();
    if (!sku) continue;

    const acc = byProblemSku.get(sku) ?? {
      sku,
      name: String(row.PRODUCT_NAME ?? '').trim(),
      defect: 0,
      expired: 0,
      utilization: 0,
    };
    acc.defect += defect;
    acc.expired += expired;
    acc.utilization += utilization;
    byProblemSku.set(sku, acc);
  }

  const problems = [...byProblemSku.values()].sort(
    (a, b) => problemTotal(b) - problemTotal(a) || a.sku.localeCompare(b.sku),
  );

  return { totals, problems };
}

function emptyTotals(): Record<TFbyStockType, number> {
  const totals = {} as Record<TFbyStockType, number>;
  for (const type of FBY_STOCK_TYPES) totals[type] = 0;
  return totals;
}

/** Пустая ячейка/мусор → 0; отрицательных остатков у Маркета не бывает. */
function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Распаковка ZIP с ЕДИНСТВЕННОЙ записью через встроенный zlib.
 *
 * Читаем не локальный заголовок, а central directory (в конце файла): в нём
 * гарантированно проставлены метод и размер сжатых данных, тогда как в локальном
 * заголовке при data-descriptor они бывают нулевыми. Метод 0 — stored (копия),
 * метод 8 — deflate (inflateRawSync). Проверено на реальном отчёте Маркета.
 */
function unzipSingleEntry(buffer: Buffer): string {
  const EOCD_SIG = 0x06054b50;
  const CDH_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;

  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Отчёт FBY: не ZIP (нет EOCD)');

  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (buffer.readUInt32LE(cdOffset) !== CDH_SIG) {
    throw new Error('Отчёт FBY: повреждён central directory');
  }

  const method = buffer.readUInt16LE(cdOffset + 10);
  const compressedSize = buffer.readUInt32LE(cdOffset + 20);
  const localOffset = buffer.readUInt32LE(cdOffset + 42);
  if (buffer.readUInt32LE(localOffset) !== LFH_SIG) {
    throw new Error('Отчёт FBY: повреждён локальный заголовок');
  }

  const nameLen = buffer.readUInt16LE(localOffset + 26);
  const extraLen = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  const raw = method === 0 ? compressed : inflateRawSync(compressed);
  return raw.toString('utf8');
}
