/**
 * Чтение таблицы, присланной продавцом (xlsx, xls, csv), — общее для ручной
 * загрузки журнала ЯМ (`finance/ym-netting-file.ts`) и файла цен
 * (`price-set/price-set-file.ts`). Две копии разошлись бы на первой же
 * кодировке: кабинеты отдают CSV то в UTF-8 с BOM, то в windows-1251.
 *
 * Отказы — обычный `Error`: у каждого вызывающего свой класс ошибки с текстом
 * для продавца, он оборачивает.
 */

import * as XLSX from 'xlsx';

/** Книга из файла; формат — по расширению имени (CSV) или по содержимому. */
export function readSpreadsheet(buffer: Buffer, fileName: string): XLSX.WorkBook {
  if (/\.csv$/i.test(fileName)) {
    // raw: значения CSV остаются текстом — иначе SheetJS сам угадывает даты, и
    // «05.10» легко становится маем. Кабинет может отдать CSV в windows-1251.
    return XLSX.read(decodeCsv(buffer), { type: 'string', raw: true });
  }
  return XLSX.read(buffer, { type: 'buffer' });
}

/** Лист → строки ячеек как есть; пустые ячейки — `''`, пустые строки сохраняются (номера строк). */
export function sheetRows(workbook: XLSX.WorkBook, sheet: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], {
    header: 1,
    raw: true,
    defval: '',
    blankrows: true,
  });
}

/** UTF-8 (с BOM или без), иначе windows-1251. */
export function decodeCsv(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1251').decode(buffer);
  }
}

/**
 * Заголовок → форма для сравнения: регистр, ё→е, «₽»/«руб.», кавычки и знаки
 * препинания, пробелы (и неразрывные) — Excel и кабинет пишут одно и то же
 * по-разному, а различия эти ничего не значат.
 */
export function normalizeHeader(value: unknown): string {
  return (
    String(value ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[«»"'`.,:;()[\]₽]/g, ' ')
      // Не `\bруб\b`: в JS \b — граница ASCII-слова, перед кириллицей не срабатывает.
      .replace(/(^|\s)руб(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
