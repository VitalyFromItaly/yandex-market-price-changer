/**
 * Общая доставка загрузки финотчёта файлом: отчёт по платежам ЯМ в «Финансах»
 * (TASK-114) и отчёт WB «Продвижение» в «Финучёте» (TASK-209). Логики учёта
 * здесь нет — только проверка запроса и перевод отказов в коды для фронта:
 * одни и те же коды файла (`FINANCE_FILE_*`) у обоих маршрутов, и фронт
 * показывает их одной карточкой.
 */

import type { IFinanceScreenMonth } from '../../finance/finance-screen';
import type { IUploadedFile } from '../price-list/crm-price-list.domain';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { FINANCE_ORIGINAL_MAX_BYTES } from '../../../database/postgres/finance.schema';
import { FinanceImportBusyError, FinanceNoStoreError } from '../../finance/finance-import.service';
import { financeToday } from '../../finance/finance-period';
import { parseScreenMonth, screenMonths } from '../../finance/finance-screen';
import { NettingFileError } from '../../finance/ym-netting-file';
import { WbNotConnectedError } from '../../wb/wb-seller-client';
import { NOT_CONNECTED } from '../connections/crm-connections.domain';
import { createUploadInterceptor } from '../crm-upload.interceptor';
import { decodeFileName, INVALID_FILE } from '../price-list/crm-price-list.domain';

import {
  FINANCE_FILE_BAD_ROW,
  FINANCE_FILE_UNRECOGNIZED,
  FINANCE_FILE_WRONG_REPORT,
  FINANCE_IMPORT_BUSY,
  FINANCE_NO_STORE,
  FINANCE_UPLOAD_EXTENSIONS,
  FINANCE_UPLOAD_MONTH_TEXT,
  FINANCE_UPLOAD_TOO_LARGE_TEXT,
  INVALID_FINANCE_REQUEST,
} from './crm-finance.domain';

/**
 * Финотчёт файлом: лимит — потолок оригинала в документе, чтобы загруженный
 * файл сохранялся всегда и его можно было скачать из операции.
 */
export const FinanceUploadInterceptor = createUploadInterceptor({
  maxBytes: FINANCE_ORIGINAL_MAX_BYTES,
  tooLargeMessage: FINANCE_UPLOAD_TOO_LARGE_TEXT,
});

export function invalidFile(message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code: INVALID_FILE, field: 'file', message });
}

/**
 * Файл и месяц запроса → имя файла как у продавца и месяц экрана. Месяц —
 * выбор продавца (`finance_upload_month_picked`): текущий или один из
 * двенадцати прошлых, по датам строк не угадывается.
 */
export function acceptedUpload(
  file: IUploadedFile | undefined,
  monthValue: unknown,
  texts: { noFile: string; badExtension: string },
  now: Date = new Date(),
): { filename: string; month: IFinanceScreenMonth } {
  if (!file) throw invalidFile(texts.noFile);
  const filename = decodeFileName(file.originalname);
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (!FINANCE_UPLOAD_EXTENSIONS.some((allowed) => allowed === ext)) {
    throw invalidFile(texts.badExtension);
  }
  const month = parseScreenMonth(monthValue);
  const allowed = screenMonths(financeToday(now)).map((m) => m.month);
  if (!month || !allowed.includes(month.month)) {
    throw new BadRequestException({
      statusCode: 400,
      code: INVALID_FINANCE_REQUEST,
      field: 'month',
      message: FINANCE_UPLOAD_MONTH_TEXT,
    });
  }
  return { filename, month };
}

const NETTING_FILE_ERROR_CODE: Record<NettingFileError['kind'], string> = {
  unrecognized: FINANCE_FILE_UNRECOGNIZED,
  'wrong-report': FINANCE_FILE_WRONG_REPORT,
  'bad-row': FINANCE_FILE_BAD_ROW,
  empty: INVALID_FILE,
  unreadable: INVALID_FILE,
};

/** Отказы загрузки → коды для фронта; остальное уходит общим фильтром (500 + журнал). */
export function financeUploadError(error: unknown): unknown {
  if (error instanceof NettingFileError) {
    const code = NETTING_FILE_ERROR_CODE[error.kind];
    return new BadRequestException({
      statusCode: 400,
      code,
      field: 'file',
      message: error.message,
      ...error.details,
    });
  }
  if (error instanceof FinanceImportBusyError) {
    return new ConflictException({
      statusCode: 409,
      code: FINANCE_IMPORT_BUSY,
      message: error.message,
    });
  }
  if (error instanceof FinanceNoStoreError) {
    return new ConflictException({
      statusCode: 409,
      code: FINANCE_NO_STORE,
      message: error.message,
    });
  }
  if (error instanceof WbNotConnectedError) {
    return new ConflictException({
      statusCode: 409,
      code: NOT_CONNECTED,
      message: 'WB не подключён — сначала добавьте ключ в «Подключениях».',
    });
  }
  return error;
}
