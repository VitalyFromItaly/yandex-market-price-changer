/**
 * Движение денежных средств периода (ДДС), фактические выплаты и деньги к
 * получению (TASK-122, ТЗ п.3). Чистые функции — без Nest и базы.
 *
 * ДДС — это деньги, которые пришли и ушли в дни периода, а не начисления:
 *
 * - **Поступления** — выплаты Маркета. Своей строки у выплаты в журнале нет:
 *   каждая операция несёт поля платёжного поручения (`paidAt`, `bankOrderId`,
 *   `bankSumKopecks` — сумма всего поручения на каждой строке). Выплата — это
 *   поручение, то есть строки с одним `bankOrderId`, в период — по дню
 *   `paidAt` по Москве. Начислены его строки могли раньше: это и есть разница
 *   между ДДС и P&L (решение `pnl_accrual_date`).
 * - **Оплаты закупок** — по дню оплаты. В P&L их нет и не будет: себестоимость
 *   проданного P&L берёт по продажам, закупка списала бы товар второй раз.
 * - **Операционные расходы** — разовый по своему дню, ежемесячный ЦЕЛИКОМ раз в
 *   месяц в число из дня начала (решение `cashflow_monthly_expense_start_day`).
 *   P&L делит его по дням (`allocate`) — это начисление, а не платёж.
 * - **Налоги** — только уплаченные, внесённые продавцом руками (решение
 *   `cashflow_tax_paid_manual`); начисленный `taxOf` остаётся в P&L.
 *
 * Итог складывается только из корзин — Σ строк = итог по построению (довод
 * `pnlOf`). Строки группы `reference` (`bonus_payment` — услуги, оплаченные
 * бонусным балансом) — не деньги: в поступления и «к получению» не идут.
 */

import type { IAllocatableExpense } from './expense-allocation';
import type { TFinanceArticle } from './finance-articles';
import type { IFinancePeriod } from './finance-period';

import { daysInMonth } from '../yandex/reports/moscow-day';

import { FINANCE_ARTICLE_META } from './finance-articles';
import { financeToday } from './finance-period';

/** Живая строка журнала, выплаченная в окне. */
export interface IPaidOperation {
  id: string;
  article: TFinanceArticle;
  amountKopecks: number;
  bankOrderId: string | null;
  bankSumKopecks: number | null;
  paidAt: Date;
}

/** Выплата Маркета — одно платёжное поручение. */
export interface IPayout {
  /** Номер поручения; null — у строк его нет (группируются по дню). */
  bankOrderId: string | null;
  /** ГГГГ-ММ-ДД по Москве. */
  day: string;
  /** Сколько пришло: сумма поручения, а без неё — Σ строк. */
  kopecks: number;
  /** Σ денежных строк поручения в журнале. */
  linesKopecks: number;
  operationCount: number;
  /**
   * Σ строк ≠ сумме поручения (или у строк разные суммы поручения). Находку
   * пишет сверка TASK-113; здесь — только флаг, чтобы экран не молчал.
   */
  mismatch: boolean;
}

export interface ICashflowPurchase {
  id: string;
  supplier: string;
  paidDay: string;
  amountKopecks: number;
}

export interface ICashflowTaxPayment {
  id: string;
  paidDay: string;
  amountKopecks: number;
}

export interface ICashflowInput {
  period: IFinancePeriod;
  paid: readonly IPaidOperation[];
  purchases: readonly ICashflowPurchase[];
  expenses: readonly IAllocatableExpense[];
  taxPayments: readonly ICashflowTaxPayment[];
}

export interface ICashflow {
  period: IFinancePeriod;
  inflow: { payoutsKopecks: number; totalKopecks: number };
  outflow: {
    purchasesKopecks: number;
    expensesKopecks: number;
    /** Ненулевые по категориям; Σ = expensesKopecks. */
    expensesByCategory: Record<string, number>;
    taxesKopecks: number;
    totalKopecks: number;
  };
  /** Поступления − выбытия. */
  netKopecks: number;
  payouts: IPayout[];
  /** Выплаты периода по статьям (`payoutArticlesOf`). */
  payoutArticles: IPayoutArticle[];
  purchases: ICashflowPurchase[];
  taxPayments: ICashflowTaxPayment[];
}

/** Сумма к получению по статье (агрегат из базы). */
export interface IReceivableRow {
  article: TFinanceArticle;
  kopecks: number;
  operationCount: number;
}

export interface IReceivable {
  totalKopecks: number;
  operationCount: number;
  /** Ненулевые статьи, по убыванию модуля суммы; Σ = totalKopecks. */
  byArticle: IReceivableRow[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const isMoney = (article: TFinanceArticle) => FINANCE_ARTICLE_META[article].group !== 'reference';

const inPeriod = (day: string, period: IFinancePeriod) => day >= period.from && day <= period.to;

/**
 * Дни, в которые расход уходит деньгами в пределах периода. Ежемесячный — раз
 * в месяц в число дня начала; в месяце, где такого числа нет (31-е в
 * феврале), — в последний день.
 */
export function expenseCashDays(expense: IAllocatableExpense, period: IFinancePeriod): string[] {
  if (expense.kind === 'one_off') return inPeriod(expense.fromDay, period) ? [expense.fromDay] : [];

  const dayOfMonth = Number(expense.fromDay.slice(8, 10));
  const start = expense.fromDay > period.from ? expense.fromDay : period.from;
  const end = expense.toDay !== null && expense.toDay < period.to ? expense.toDay : period.to;
  if (start > end) return [];

  const days: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const lastKey = end.slice(0, 7);
  for (;;) {
    const key = `${year}-${pad2(month)}`;
    const day = `${key}-${pad2(Math.min(dayOfMonth, daysInMonth(year, month)))}`;
    if (day >= start && day <= end) days.push(day);
    if (key === lastKey) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return days;
}

interface IPayoutGroup {
  bankOrderId: string | null;
  day: string;
  ops: IPaidOperation[];
  /** Денежные строки (без группы `reference`) — из них и сумма, и разбивка по статьям. */
  money: IPaidOperation[];
}

/**
 * Поручения периода: строки по поручению, поручение — в период по дню `paidAt`.
 * Без номера поручения строки собираются по дню. Одна группировка на выплаты и
 * на их разбивку по статьям — Σ разбивки = Σ строк выплат по построению.
 */
function payoutGroups(paid: readonly IPaidOperation[], period: IFinancePeriod): IPayoutGroup[] {
  const groups = new Map<
    string,
    { bankOrderId: string | null; day: string; ops: IPaidOperation[] }
  >();
  for (const op of paid) {
    const day = financeToday(op.paidAt);
    const key = op.bankOrderId ? `order:${op.bankOrderId}` : `day:${day}`;
    const group = groups.get(key) ?? { bankOrderId: op.bankOrderId, day, ops: [] };
    // День поручения — самый ранний среди строк (у одного поручения он один).
    if (day < group.day) group.day = day;
    group.ops.push(op);
    groups.set(key, group);
  }
  const result: IPayoutGroup[] = [];
  for (const group of groups.values()) {
    if (!inPeriod(group.day, period)) continue;
    const money = group.ops.filter((op) => isMoney(op.article));
    if (money.length) result.push({ ...group, money });
  }
  return result;
}

/**
 * Выплаты периода — по поручению. Порядок — по дню, затем по номеру.
 */
export function payoutsOf(paid: readonly IPaidOperation[], period: IFinancePeriod): IPayout[] {
  const payouts: IPayout[] = [];
  for (const { bankOrderId, day, ops, money } of payoutGroups(paid, period)) {
    const linesKopecks = money.reduce((sum, op) => sum + op.amountKopecks, 0);
    const sums = new Set(ops.map((op) => op.bankSumKopecks).filter((v): v is number => v !== null));
    const [bankSum] = [...sums];
    const single = sums.size === 1 && bankOrderId !== null;
    payouts.push({
      bankOrderId,
      day,
      kopecks: single ? bankSum : linesKopecks,
      linesKopecks,
      operationCount: money.length,
      mismatch: sums.size > 1 || (single && bankSum !== linesKopecks),
    });
  }
  return payouts.sort(
    (a, b) =>
      a.day.localeCompare(b.day) || (a.bankOrderId ?? '').localeCompare(b.bankOrderId ?? ''),
  );
}

/** Статья в выплатах периода: сколько и какими строками. */
export interface IPayoutArticle {
  article: TFinanceArticle;
  kopecks: number;
  operationIds: string[];
}

/**
 * Из чего сложились выплаты периода — денежные строки тех же поручений, что
 * `payoutsOf`, по статьям (TASK-150: «почему изменились выплаты»). Σ = Σ
 * `linesKopecks` выплат. Порядок — по убыванию модуля суммы.
 */
export function payoutArticlesOf(
  paid: readonly IPaidOperation[],
  period: IFinancePeriod,
): IPayoutArticle[] {
  const byArticle = new Map<TFinanceArticle, IPayoutArticle>();
  for (const { money } of payoutGroups(paid, period))
    for (const op of money) {
      const row = byArticle.get(op.article) ?? {
        article: op.article,
        kopecks: 0,
        operationIds: [],
      };
      row.kopecks += op.amountKopecks;
      row.operationIds.push(op.id);
      byArticle.set(op.article, row);
    }
  return [...byArticle.values()].sort(
    (a, b) => Math.abs(b.kopecks) - Math.abs(a.kopecks) || a.article.localeCompare(b.article),
  );
}

/** ДДС периода. Закупки и налоги вне периода отбрасываются здесь же. */
export function cashflowOf(input: ICashflowInput): ICashflow {
  const { period } = input;
  const payouts = payoutsOf(input.paid, period);
  const payoutsKopecks = payouts.reduce((sum, payout) => sum + payout.kopecks, 0);

  const purchases = input.purchases.filter((row) => inPeriod(row.paidDay, period));
  const purchasesKopecks = purchases.reduce((sum, row) => sum + row.amountKopecks, 0);

  const expensesByCategory: Record<string, number> = {};
  let expensesKopecks = 0;
  for (const expense of input.expenses) {
    const kopecks = expenseCashDays(expense, period).length * expense.amountKopecks;
    if (!kopecks) continue;
    expensesKopecks += kopecks;
    expensesByCategory[expense.category] = (expensesByCategory[expense.category] ?? 0) + kopecks;
  }

  const taxPayments = input.taxPayments.filter((row) => inPeriod(row.paidDay, period));
  const taxesKopecks = taxPayments.reduce((sum, row) => sum + row.amountKopecks, 0);

  const outflowTotal = purchasesKopecks + expensesKopecks + taxesKopecks;
  return {
    period,
    inflow: { payoutsKopecks, totalKopecks: payoutsKopecks },
    outflow: {
      purchasesKopecks,
      expensesKopecks,
      expensesByCategory,
      taxesKopecks,
      totalKopecks: outflowTotal,
    },
    netKopecks: payoutsKopecks - outflowTotal,
    payouts,
    payoutArticles: payoutArticlesOf(input.paid, period),
    purchases,
    taxPayments,
  };
}

/**
 * Деньги к получению: начислено, но ещё не выплачено (`paidAt` пуст). Строки
 * группы `reference` — не деньги, их нет. Знак сохраняется: удержание,
 * начисленное раньше выплаты, уменьшает ожидаемое.
 */
export function receivableOf(rows: readonly IReceivableRow[]): IReceivable {
  const byArticle = rows
    .filter((row) => isMoney(row.article) && row.kopecks !== 0)
    .sort(
      (a, b) => Math.abs(b.kopecks) - Math.abs(a.kopecks) || a.article.localeCompare(b.article),
    );
  return {
    totalKopecks: byArticle.reduce((sum, row) => sum + row.kopecks, 0),
    operationCount: byArticle.reduce((sum, row) => sum + row.operationCount, 0),
    byArticle,
  };
}
