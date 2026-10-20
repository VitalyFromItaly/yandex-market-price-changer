/**
 * Строка журнала операций площадки — общий контракт записи в
 * `finance_operations` для всех площадок (ЯМ — `ym-journal.ts`, Ozon —
 * `ozon-journal.ts`). Жил в `ym-journal.ts`, пока площадка была одна.
 *
 * Лист: только типы.
 */

import type { TFinanceArticle } from './finance-articles';
import type { IOperationBreakdownPart } from './operation-breakdown';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';

/** Что импорт знает о версии документа, в которую ложатся операции. */
export interface IFinanceOperationContext {
  telegramUserId: string;
  businessId: string;
  documentId: string;
  documentVersion: number;
  /** Период документа (`financePeriodKey`) — чтобы найти строки, снятые новой версией. */
  periodKey: string;
}

/** Поля FinanceOperation, получаемые из одной операции площадки. */
export interface IFinanceOperationRow {
  marketplace: TFinanceMarketplace;
  telegramUserId: string;
  businessId: string;
  operationKey: string;
  article: TFinanceArticle;
  direction: 'income' | 'expense';
  amountKopecks: number;
  orderId?: string;
  sku?: string;
  serviceName?: string;
  transactionType: string;
  transactionSource?: string;
  accruedAt: Date;
  actId?: string;
  actDate?: Date;
  model?: string;
  paymentStatus?: string;
  paidAt?: Date;
  bankOrderId?: string;
  bankSumKopecks?: number;
  documentId: string;
  documentVersion: number;
  periodKey: string;
  raw: Record<string, unknown>;
  /**
   * Расшифровка по статьям: сводная строка акта ЯМ (TASK-155), составляющие
   * операции Ozon (TASK-131). Ставит импорт.
   */
  breakdown?: IOperationBreakdownPart[];
}
