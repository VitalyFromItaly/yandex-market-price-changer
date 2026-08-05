import type {
  IFbyProblemSku,
  IFbyStockRow,
  IFbyStockSummary,
  TFbyStockType,
} from './fby-stock-report';

import * as XLSX from 'xlsx';

import { FBY_STOCK_TYPES } from './fby-stock-report';

/**
 * Выгрузка сводки FBY в .xlsx — три листа.
 *
 * Почему файл вообще есть: в сообщение Telegram помещается 4096 символов, а
 * отчёт «Остатки на складах» — это тысячи строк SKU×склад. Показать их в чате
 * нельзя ни при каком пороге, поэтому сообщение осталось СВОДКОЙ, а полные
 * данные всегда уходят файлом — не «когда не влезло», а всегда: иначе продавцу
 * пришлось бы гадать, почему в этот раз файла нет.
 *
 * Отдельный билдер, а не `report-workbook.ts`: тот жёстко завязан на заказы
 * (колонки заказа, суммы через orderTotals, лист «Заказы», префикс имени). Здесь
 * переиспользуется только идиома SheetJS (AOA → лист → Buffer, потолок строк) и
 * форма результата. Файл на диск не пишется — книга уходит в Telegram из памяти
 * (тот же принцип, что в report-workbook).
 */

/** Потолок строк — как в report-workbook: книга целиком лежит в памяти. */
export const MAX_EXPORT_ROWS = 20_000;

/** Заголовки типов остатков — в порядке FBY_STOCK_TYPES, чтобы не разъезжались. */
const TYPE_HEADER: Readonly<Record<TFbyStockType, string>> = {
  AVAILABLE: 'Доступно к заказу',
  FIT: 'Годный',
  FREEZE: 'Резерв',
  QUARANTINE: 'Карантин',
  DEFECT: 'Брак',
  EXPIRED: 'Просрочка',
  UTILIZATION: 'К утилизации',
};

const PROBLEM_HEADERS = ['SKU', 'Название', 'Брак', 'Просрочка', 'К утилизации'] as const;

export interface IWorkbookResult {
  buffer: Buffer;
  /** Сколько строк ушло в лист позиций. */
  rows: number;
  /** Сколько позиций отброшено потолком. Ноль — выгружено всё. */
  truncated: number;
}

const typeHeaders = (): string[] => FBY_STOCK_TYPES.map((type) => TYPE_HEADER[type]);
const typeValues = (totals: Readonly<Record<TFbyStockType, number>>): number[] =>
  FBY_STOCK_TYPES.map((type) => totals[type]);

/** Лист «Остатки по складам»: склад × типы плюс строка ИТОГО. */
function warehouseSheet(byWarehouse: IFbyStockSummary['byWarehouse']): XLSX.WorkSheet {
  const names = Object.keys(byWarehouse).sort((a, b) => a.localeCompare(b, 'ru'));
  const rows: (string | number)[][] = [['Склад', ...typeHeaders()]];
  const total = {} as Record<TFbyStockType, number>;
  for (const type of FBY_STOCK_TYPES) total[type] = 0;

  for (const name of names) {
    const totals = byWarehouse[name];
    for (const type of FBY_STOCK_TYPES) total[type] += totals[type];
    // Пустое имя бывает у строк CSV без колонки WAREHOUSE — парсер их не
    // выбрасывает, чтобы сумма сходилась с общими итогами.
    rows.push([name || 'склад без названия', ...typeValues(totals)]);
  }

  rows.push([]);
  rows.push(['ИТОГО', ...typeValues(total)]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 44 }, ...FBY_STOCK_TYPES.map(() => ({ wch: 18 }))];
  return sheet;
}

/** Лист «Позиции по складам»: та самая таблица SKU×склад из отчёта. */
function positionsSheet(detailed: readonly IFbyStockRow[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [['SKU', 'Название', 'Склад', ...typeHeaders()]];
  for (const row of detailed) {
    rows.push([row.sku, row.name, row.warehouse, ...typeValues(row.totals)]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 20 },
    { wch: 44 },
    { wch: 30 },
    ...FBY_STOCK_TYPES.map(() => ({ wch: 18 })),
  ];
  return sheet;
}

/** Лист «Проблемные FBY»: брак/просрочка/утиль, суммой по складам. */
function problemSheet(problems: readonly IFbyProblemSku[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [[...PROBLEM_HEADERS]];
  let totalDefect = 0;
  let totalExpired = 0;
  let totalUtil = 0;

  for (const p of problems) {
    totalDefect += p.defect;
    totalExpired += p.expired;
    totalUtil += p.utilization;
    rows.push([p.sku, p.name, p.defect, p.expired, p.utilization]);
  }

  rows.push([]);
  rows.push(['ИТОГО', `Позиций: ${problems.length}`, totalDefect, totalExpired, totalUtil]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 20 }, { wch: 44 }, { wch: 8 }, { wch: 10 }, { wch: 12 }];
  return sheet;
}

export function buildFbyWorkbook(summary: IFbyStockSummary): IWorkbookResult {
  // Потолок бьёт по самому длинному листу — построчному. Склады и проблемные
  // позиции короче него на порядки и режутся тем же числом только формально.
  const exported = summary.rows.slice(0, MAX_EXPORT_ROWS);
  const truncated = summary.rows.length - exported.length;

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, warehouseSheet(summary.byWarehouse), 'Остатки по складам');
  XLSX.utils.book_append_sheet(book, positionsSheet(exported), 'Позиции по складам');
  XLSX.utils.book_append_sheet(
    book,
    problemSheet(summary.problems.slice(0, MAX_EXPORT_ROWS)),
    'Проблемные FBY',
  );

  return {
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rows: exported.length,
    truncated,
  };
}

/** Имя файла с датой и временем — как у выгрузки «Едет до клиента». */
export function fbyFileName(dateParam: string, timeParam: string): string {
  return `fby-ostatki-${dateParam}-${timeParam.replace(':', '')}.xlsx`;
}
