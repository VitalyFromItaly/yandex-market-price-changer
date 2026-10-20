/**
 * Раскрытие до операций журнала и оригинала отчёта Маркета — общее для
 * «Финансов» (статья P&L) и «ИИ-аналитика» (ссылка ответа). Эндпоинты — под
 * фичей `finance`; оба раздела без неё не открываются.
 */

export interface FinanceOperation {
  id: string;
  article: string;
  articleTitle: string;
  amountKopecks: number;
  orderId: string | null;
  sku: string | null;
  count: number | null;
  serviceName: string | null;
  transactionType: string | null;
  transactionSource: string | null;
  accruedAt: string;
  paidAt: string | null;
  actDate: string | null;
  bankOrderId: string | null;
  /** Версия отчёта, где строка встретилась последней, — её оригинал. */
  documentId: string | null;
  /**
   * Расшифровка одной суммы по статьям (сводная строка акта ЯМ); null —
   * операция целиком своей статьи. Нет поля — старый ответ, как null.
   */
  parts?: FinanceOperationPart[] | null;
}

export interface FinanceOperationPart {
  article: string;
  articleTitle: string;
  kopecks: number;
}

/** Что раскрыто: статья или ссылка ответа — заголовок, итог и id операций. */
export interface OpenedArticle {
  title: string;
  /** Итог в шапке; null — итога нет (у ссылки ИИ-ответа суммы нет). */
  amount: string | null;
  operationIds: string[];
  /** Сколько операций всего; у ссылки id бывают первыми N из большего числа. */
  operationCount?: number;
  /**
   * Ключ статьи P&L: у расшифрованной строки в таблице — доля этой статьи, и
   * сумма раскрытия сходится с итогом. Нет — ссылка ИИ-ответа, строка целиком.
   */
  article?: string;
}

export interface OperationRow {
  id: string;
  day: string;
  /** Тип и источник строки журнала: «Удержание · Оплата услуг Маркета». */
  kind: string;
  service: string | null;
  order: string | null;
  sku: string | null;
  amount: string;
  negative: boolean;
  /** «из 51 852,00 ₽» — у доли расшифрованной строки; иначе null. */
  partOf: string | null;
  documentId: string | null;
}

/** Операций на странице раскрытия; сервер принимает до 200 id. */
export const OPERATIONS_PAGE_SIZE = 50;

export const ORIGINAL_FALLBACK_NAME = 'united-netting.zip';
