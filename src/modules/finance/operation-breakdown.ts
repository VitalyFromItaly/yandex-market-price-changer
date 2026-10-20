/**
 * Расшифровка операции журнала по статьям (TASK-155) — поле `breakdown`.
 *
 * Операция площадки может быть одной суммой за много услуг: у ЯМ это сводная
 * строка акта «Удержание · Оплата услуг Маркета» без названия услуги. Её
 * разбивка приходит из другого отчёта и хранится полем на той же операции
 * (решение `finance_act_breakdown_field`), а не отдельными строками: ключ
 * дедупа, выплата и поручение у операции одни, и сумма выплаты не может
 * удвоиться по построению. Разворачивает поле одна функция — `expandBreakdown`,
 * и зовёт её чтение для P&L, так что статьи «Финансов», «Обзора» и
 * unit-экономики складываются из частей, а деньги поручения — из строки.
 *
 * Лист: импортирует только лист статей.
 */

import type { TFinanceArticle } from './finance-articles';

import { isFinanceArticle } from './finance-articles';

export interface IOperationBreakdownPart {
  article: TFinanceArticle;
  /** Со знаком операции: удержание — «−». Σ частей = сумме операции. */
  kopecks: number;
  /** Откуда часть: лист отчёта услуг. null — остаток, которому листа не нашлось. */
  sheet: string | null;
}

/**
 * jsonb из базы → части. Битая запись (не массив, чужая статья, дробные
 * копейки) — null, то есть «расшифровки нет»: операция читается своей статьёй
 * целиком, а не теряет сумму.
 */
export function breakdownOf(value: unknown): IOperationBreakdownPart[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const parts: IOperationBreakdownPart[] = [];
  for (const item of value) {
    const part = item as Partial<IOperationBreakdownPart> | null;
    if (!part || !isFinanceArticle(part.article) || !Number.isInteger(part.kopecks)) return null;
    parts.push({
      article: part.article,
      kopecks: part.kopecks as number,
      sheet: typeof part.sheet === 'string' ? part.sheet : null,
    });
  }
  return parts;
}

/**
 * Операция с расшифровкой → по строке на статью (части одной статьи
 * складываются): id, даты и поля — операции, статья и сумма — части.
 *
 * Σ частей не сходится с суммой операции (запись испорчена руками или старым
 * кодом) — операция остаётся целой: подогнанная разбивка солгала бы в каждой
 * статье, а целая строка честно лежит своей статьёй.
 */
export function expandBreakdown<
  T extends { article: TFinanceArticle; amountKopecks: number; breakdown?: unknown },
>(ops: readonly T[]): Omit<T, 'breakdown'>[] {
  const result: Omit<T, 'breakdown'>[] = [];
  for (const op of ops) {
    const { breakdown, ...rest } = op;
    const parts = breakdownOf(breakdown);
    const total = parts?.reduce((sum, p) => sum + p.kopecks, 0);
    if (!parts || total !== op.amountKopecks) {
      result.push(rest);
      continue;
    }
    const byArticle = new Map<TFinanceArticle, number>();
    for (const part of parts) {
      byArticle.set(part.article, (byArticle.get(part.article) ?? 0) + part.kopecks);
    }
    for (const [article, kopecks] of byArticle) {
      result.push({ ...rest, article, amountKopecks: kopecks } as Omit<T, 'breakdown'>);
    }
  }
  return result;
}
