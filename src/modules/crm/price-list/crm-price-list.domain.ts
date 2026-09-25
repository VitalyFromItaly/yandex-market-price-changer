import type { TUploadWarning } from '../../yandex/stocks/stock-upload-policy';

/**
 * Прайс в CRM: загрузка файла и список закупочных цен. Чистые разборщики и
 * коды ответов — отдельно от контроллера (паттерн crm-settings.domain).
 */

/** kind задачи в `CrmJobResult` — дедуп «один прайс продавца за раз». */
export const PRICE_LIST_UPLOAD_KIND = 'price-list:upload';

/** 413: файл больше лимита. */
export const FILE_TOO_LARGE = 'FILE_TOO_LARGE';
/** 400: файла нет или расширение не то; `field: 'file'`. */
export const INVALID_FILE = 'INVALID_FILE';
/** 409: предыдущий прайс ещё обрабатывается; в ответе его `jobId`. */
export const UPLOAD_RUNNING = 'UPLOAD_RUNNING';

export const UPLOAD_RUNNING_TEXT =
  'Предыдущий прайс ещё обрабатывается — дождитесь результата и загрузите файл снова.';
export const NO_FILE_TEXT = 'Выберите файл прайса (.xlsx или .xls).';

/** Файл из multer (memoryStorage) — только нужные поля, без @types/multer. */
export interface IUploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/**
 * Имя файла в UTF-8. busboy без `defParamCharset` читает имя из заголовка
 * части как latin1, а multer эту опцию не пробрасывает: «прайс.xlsx»
 * приходит как «Ð¿ÑÐ°Ð¹Ñ.xlsx». Строка из одних ASCII-символов не меняется.
 */
export function decodeFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  // Невалидный UTF-8 (имя и правда было latin1) даёт U+FFFD — тогда как есть.
  return decoded.includes('�') ? name : decoded;
}

/** `dryRun` из multipart-поля: только явное «true» включает проверку. */
export function parseDryRun(value: unknown): boolean {
  return value === 'true' || value === true;
}

export interface ICrmUploadAccepted {
  jobId: string;
  /** Предупреждение до обработки — то же, что бот шлёт отдельным сообщением. */
  warning: { code: TUploadWarning; text: string } | null;
  /** Что будет сделано с файлом. */
  progress: string;
  /** Сколько файлов (бота и CRM) впереди в общей очереди. */
  ahead: number;
}

export interface ICrmPurchasePriceItem {
  sku: string;
  name: string | null;
  category: string | null;
  /** Цена в прайсе — как в файле. */
  price: number;
  /** Закуп после скидки бренда — то, что считает «Прибыль». */
  cost: number;
  updatedAt: string | null;
}

export interface ICrmPurchasePricesView {
  items: ICrmPurchasePriceItem[];
  total: number;
  page: number;
  limit: number;
  /** Когда прайс загружали последний раз; `null` — ни разу. */
  lastUpdatedAt: string | null;
}

export const PURCHASE_PRICE_PAGE_DEFAULT = 50;

/** Параметры списка из query: мусор — к умолчаниям, а не 400. */
export function parseListQuery(query: Record<string, unknown>): {
  q: string;
  page: number;
  limit: number;
} {
  const q = typeof query.q === 'string' ? query.q.slice(0, 200) : '';
  const page = Number(query.page);
  const limit = Number(query.limit);
  return {
    q,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 ? limit : PURCHASE_PRICE_PAGE_DEFAULT,
  };
}
