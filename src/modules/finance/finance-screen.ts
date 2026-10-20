/**
 * Экран «Финансы» CRM (TASK-124): месяцы, раскрытие статьи до операций.
 * Чистые функции — без Nest и базы.
 *
 * Период экрана — календарный месяц (решение `finance_crm_month_picker`):
 * статус, сверка и версия оригинала отчёта у журнала помесячные, и любой
 * другой срез показывал бы статус, который нечем подтвердить.
 */

import type { TFinanceArticle } from './finance-articles';
import type { IFinancePeriod } from './finance-period';
import type { IOperationBreakdownPart } from './operation-breakdown';

import { monthPeriod } from './finance-period';

/** Месяцев в выборе: текущий и двенадцать прошлых. */
export const FINANCE_SCREEN_MONTHS = 13;

/**
 * Потолок id в одном запросе раскрытия. Статья месяца — тысячи операций, и
 * фронт листает их страницами; без потолка один запрос тянул бы весь журнал.
 */
export const MAX_SCREEN_OPERATION_IDS = 200;

/** Операция журнала для экрана — без сырой строки отчёта. */
export interface IFinanceScreenOperation {
  id: string;
  article: TFinanceArticle;
  amountKopecks: number;
  orderId: string | null;
  sku: string | null;
  serviceName: string | null;
  transactionType: string | null;
  transactionSource: string | null;
  accruedAt: Date;
  paidAt: Date | null;
  actDate: Date | null;
  bankOrderId: string | null;
  /** Версия отчёта, в которой строка встретилась последней, — её оригинал и скачивается. */
  documentId: string | null;
  count: string | null;
  /** Расшифровка одной суммы по статьям (TASK-155); null — операция целиком своей статьи. */
  breakdown?: IOperationBreakdownPart[] | null;
}

export interface IFinanceScreenMonth {
  /** «ГГГГ-ММ». */
  month: string;
  period: IFinancePeriod;
}

const MONTH = /^(\d{4})-(\d{2})$/;

/** «ГГГГ-ММ» → календарный месяц. Мусор → null. */
export function parseScreenMonth(value: unknown): IFinanceScreenMonth | null {
  const m = typeof value === 'string' ? MONTH.exec(value.trim()) : null;
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { month: `${m[1]}-${m[2]}`, period: monthPeriod(Number(m[1]), month) };
}

/** Месяцы выбора от текущего к старшему; `today` — «ГГГГ-ММ-ДД» по Москве. */
export function screenMonths(today: string, count = FINANCE_SCREEN_MONTHS): IFinanceScreenMonth[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const result: IFinanceScreenMonth[] = [];
  for (let shift = 0; shift < count; shift++) {
    const index = year * 12 + (month - 1) - shift;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    result.push({ month: key, period: monthPeriod(y, m) });
  }
  return result;
}

/** Месяц перед данным — база сравнения ИИ-разбора периода (TASK-150). */
export function previousScreenMonth(month: IFinanceScreenMonth): IFinanceScreenMonth {
  const [year, number] = month.month.split('-').map(Number);
  const index = year * 12 + (number - 1) - 1;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { month: `${y}-${String(m).padStart(2, '0')}`, period: monthPeriod(y, m) };
}
