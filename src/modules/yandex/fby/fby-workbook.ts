import type { IFbyProblemSku } from './fby-stock-report';

import * as XLSX from 'xlsx';

/**
 * Выгрузка проблемных позиций FBY (брак/просрочка/утилизация) в .xlsx.
 *
 * Отдельный билдер, а не `report-workbook.ts`: тот жёстко завязан на заказы
 * (колонки заказа, суммы через orderTotals, лист «Заказы», префикс имени). Здесь
 * переиспользуется только идиома SheetJS (AOA → лист → Buffer, потолок строк) и
 * форма результата. Файл на диск не пишется — книга уходит в Telegram из памяти
 * (тот же принцип, что в report-workbook).
 */

/** Потолок строк — как в report-workbook: книга целиком лежит в памяти. */
export const MAX_EXPORT_ROWS = 20_000;

const HEADERS = ['SKU', 'Название', 'Брак', 'Просрочка', 'К утилизации'] as const;

export interface IWorkbookResult {
  buffer: Buffer;
  rows: number;
  /** Сколько позиций отброшено потолком. Ноль — выгружено всё. */
  truncated: number;
}

export function buildFbyProblemWorkbook(problems: readonly IFbyProblemSku[]): IWorkbookResult {
  const exported = problems.slice(0, MAX_EXPORT_ROWS);
  const truncated = problems.length - exported.length;

  const rows: (string | number)[][] = [[...HEADERS]];
  let totalDefect = 0;
  let totalExpired = 0;
  let totalUtil = 0;

  for (const p of exported) {
    totalDefect += p.defect;
    totalExpired += p.expired;
    totalUtil += p.utilization;
    rows.push([p.sku, p.name, p.defect, p.expired, p.utilization]);
  }

  rows.push([]);
  rows.push(['ИТОГО', `Позиций: ${exported.length}`, totalDefect, totalExpired, totalUtil]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 20 }, { wch: 44 }, { wch: 8 }, { wch: 10 }, { wch: 12 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Проблемные FBY');

  return {
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rows: exported.length,
    truncated,
  };
}

/** Имя файла с датой и временем — как у выгрузки «Едет до клиента». */
export function fbyProblemFileName(dateParam: string, timeParam: string): string {
  return `fby-problemnye-${dateParam}-${timeParam.replace(':', '')}.xlsx`;
}
