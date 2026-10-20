import type {
  PurchasePricesPage,
  PurchasePricesResponse,
  StockSyncCount,
  StockSyncData,
  StockSyncResult,
  UploadAccepted,
  UploadAcceptedResponse,
  UploadErrors,
} from '../price-list.domain';

import { UPLOAD_ERROR, UPLOAD_MAX_BYTES } from '../price-list.domain';

import { ApiError } from '@/shared/http';
import { formatMoscowDate } from '@/shared/utils';

export function mapUploadAccepted(response: UploadAcceptedResponse): UploadAccepted {
  return {
    jobId: response.jobId,
    warning: response.warning?.text ?? null,
    progress: response.progress,
    ahead: response.ahead,
  };
}

/**
 * Итог загрузки → экран. Подписи строк — те же, что в отчёте бота
 * (formatStockReport); числа — как пришли, фронт их не пересчитывает.
 */
export function mapStockSync(data: StockSyncData): StockSyncResult {
  const counts: StockSyncCount[] = [
    { label: 'Строк в прайсе', value: data.totalRows, tone: 'default' },
    { label: 'Артикулов в каталоге', value: data.catalogSize, tone: 'default' },
    { label: 'Нашлось совпадений', value: data.matched, tone: 'default' },
  ];
  // Обнуление называется отдельно: это товар, который СНИМАЕТСЯ с продажи.
  if (data.zeroed > 0) {
    counts.push({ label: 'Нет в наличии → остаток 0', value: data.zeroed, tone: 'warn' });
  }
  if (data.updated !== null)
    counts.push({ label: 'Записано', value: data.updated, tone: 'default' });
  if (data.purchasePricesSaved > 0) {
    counts.push({
      label: 'Закупочных цен сохранено',
      value: data.purchasePricesSaved,
      tone: 'default',
    });
  }
  if (data.skipped.length > 0) {
    counts.push({ label: 'Пропущено', value: data.skipped.length, tone: 'warn' });
  }
  const lost = data.errors.reduce((sum, error) => sum + error.skus.length, 0);
  if (lost > 0) counts.push({ label: 'Не записано из-за ошибок', value: lost, tone: 'danger' });

  return {
    headline: data.headline,
    success: !data.dryRun && data.writeSkipReason === null && data.errors.length === 0,
    explanation: data.explanation,
    advice: data.advice,
    counts,
    pricesSkippedNote: data.purchasePricesSkipped
      ? 'Закупочные цены не сохранялись — сохранение выключено администратором.'
      : null,
    skipped: data.skipped,
    errors: data.errors.map((error) => ({
      batch: error.batch,
      count: error.skus.length,
      message: error.message,
    })),
  };
}

export function mapPurchasePrices(response: PurchasePricesResponse): PurchasePricesPage {
  return {
    items: response.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      category: item.category,
      price: item.price,
      cost: item.cost,
    })),
    total: response.total,
    page: response.page,
    limit: response.limit,
    pages: Math.max(1, Math.ceil(response.total / Math.max(1, response.limit))),
    lastUpdated: response.lastUpdatedAt === null ? null : formatMoscowDate(response.lastUpdatedAt),
  };
}

const NO_ERRORS: UploadErrors = { file: null, form: null, runningJobId: null };

/** Ошибка загрузки → куда её поставить. Текст — серверный, он же у бота. */
export function mapUploadError(caught: unknown): UploadErrors {
  if (!(caught instanceof ApiError)) {
    return { ...NO_ERRORS, form: 'Не удалось загрузить файл. Попробуйте ещё раз.' };
  }
  if (caught.code === UPLOAD_ERROR.UPLOAD_RUNNING) {
    const jobId = caught.details?.jobId;
    return {
      ...NO_ERRORS,
      form: caught.message,
      runningJobId: typeof jobId === 'string' ? jobId : null,
    };
  }
  if (caught.code === UPLOAD_ERROR.FILE_TOO_LARGE || caught.code === UPLOAD_ERROR.INVALID_FILE) {
    return { ...NO_ERRORS, file: caught.message };
  }
  return { ...NO_ERRORS, form: caught.message };
}

/** Проверка до отправки — те же правила, что на сервере; сервер всё равно проверит сам. */
export function localFileError(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return `Нужен файл Excel (.xlsx или .xls). Выбран «${file.name}».`;
  }
  if (file.size > UPLOAD_MAX_BYTES) return 'Файл больше 10 МБ. Выберите файл меньшего размера.';
  return null;
}
