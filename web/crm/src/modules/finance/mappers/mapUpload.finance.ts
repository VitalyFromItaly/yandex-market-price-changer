import type {
  FinanceUploadErrors,
  FinanceUploadResponse,
  FinanceUploadSummary,
} from '../finance.domain';

import { FINANCE_UPLOAD_MAX_BYTES } from '../constants/upload.finance';

import { monthLabel } from './mapPnl.finance';

import { ApiError } from '@/shared/http';

const NO_ERRORS: FinanceUploadErrors = { file: null, form: null, missing: [] };

/** Коды, которые относятся к файлу и встают под его поле. */
const FILE_CODES = new Set([
  'FILE_TOO_LARGE',
  'INVALID_FILE',
  'FINANCE_FILE_UNRECOGNIZED',
  'FINANCE_FILE_WRONG_REPORT',
  'FINANCE_FILE_BAD_ROW',
]);

/** Отказ загрузки → куда его поставить. Текст — серверный. */
export function mapFinanceUploadError(caught: unknown): FinanceUploadErrors {
  if (!(caught instanceof ApiError)) {
    return { ...NO_ERRORS, form: 'Не удалось загрузить файл. Попробуйте ещё раз.' };
  }
  if (caught.code !== null && FILE_CODES.has(caught.code)) {
    const missing = caught.details?.missing;
    return {
      ...NO_ERRORS,
      file: caught.message,
      missing: Array.isArray(missing)
        ? missing.filter((m): m is string => typeof m === 'string')
        : [],
    };
  }
  return { ...NO_ERRORS, form: caught.message };
}

/** Проверка до отправки — те же правила, что на сервере. */
export function localFinanceFileError(file: { name: string; size: number }): string | null {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    return `Нужен файл .xlsx, .xls или .csv. Выбран «${file.name}».`;
  }
  if (file.size > FINANCE_UPLOAD_MAX_BYTES) return 'Файл больше 15 МБ — такой отчёт мы не примем.';
  return null;
}

/** Итог загрузки словами: сколько строк, сколько новых, что уже было. */
export function toUploadSummary(response: FinanceUploadResponse): FinanceUploadSummary {
  const month = monthLabel(response.month).toLowerCase();
  if (response.status === 'unchanged') {
    return {
      title: `Этот файл уже загружен в журнал за ${month}`,
      lines: [`Операций в нём: ${response.rows}. Журнал не менялся.`],
    };
  }
  const lines = [
    `Операций в файле: ${response.rows}.`,
    `Новых в журнале: ${response.inserted}, уже были: ${response.matched}.`,
  ];
  if (response.skippedSuperseded > 0) {
    lines.push(
      `Пропущено ${response.skippedSuperseded}: Маркет уже пересчитал эти строки в более новом отчёте.`,
    );
  }
  if (response.unknown > 0) {
    lines.push(`Без статьи: ${response.unknown} — мы уже знаем и разберём их.`);
  }
  return { title: `Отчёт загружен в журнал за ${month}`, lines };
}
