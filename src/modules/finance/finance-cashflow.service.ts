import type { ICashflow, IReceivable } from './cashflow';
import type { IFinancePeriod } from './finance-period';

import { Injectable } from '@nestjs/common';

import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';

import { cashflowOf, receivableOf } from './cashflow';
import { FinanceExpensesService } from './finance-expenses.service';
import { assertFinancePeriod, financeToday } from './finance-period';
import { FinancePurchasesService, PurchaseValidationError } from './finance-purchases.service';

export interface ICashflowReport {
  cashflow: ICashflow;
  receivable: IReceivable & {
    /** ГГГГ-ММ-ДД: «к получению» — на начало этого дня плюс начисленное в нём. */
    asOf: string;
  };
}

const DAY_MS = 86_400_000;
const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

/**
 * ДДС периода, фактические выплаты и деньги к получению (TASK-122). Читает
 * журнал, расходы, закупки и уплаченные налоги — и ничего не пишет. P&L
 * (`FinanceService.build`) отсюда не зовётся и сюда не смотрит: оплата
 * закупки меняет денежный поток, а не чистую прибыль.
 *
 * «К получению» — на сегодня, а не на конец периода: деньги, которые Маркет
 * ещё должен, — вопрос текущего момента, и строки, выплаченные после конца
 * периода, иначе считались бы «к получению» задним числом.
 */
@Injectable()
export class FinanceCashflowService {
  constructor(
    private readonly operations: FinanceOperationRepository,
    private readonly expenses: FinanceExpensesService,
    private readonly purchases: FinancePurchasesService,
  ) {}

  async build(
    telegramUserId: string,
    period: IFinancePeriod,
    now: Date = new Date(),
  ): Promise<ICashflowReport> {
    try {
      assertFinancePeriod(period);
    } catch (error) {
      throw new PurchaseValidationError('period', (error as Error).message);
    }
    const from = moscowStart(period.from);
    const to = new Date(moscowStart(period.to).getTime() + DAY_MS);

    const [paid, expenses, entries, receivable] = await Promise.all([
      this.operations.livePaidBetween(telegramUserId, from, to),
      this.expenses.snapshot(telegramUserId),
      this.purchases.between(telegramUserId, period.from, period.to),
      this.receivable(telegramUserId, now),
    ]);

    const cashflow = cashflowOf({
      period,
      paid,
      purchases: entries.purchases,
      expenses: expenses.expenses,
      taxPayments: entries.taxPayments,
    });
    return { cashflow, receivable };
  }

  /**
   * Только «к получению» — одна агрегирующая выборка, без периода. Её же берёт
   * `build`, поэтому «Обзор» (TASK-125) и ДДС не могут разойтись.
   */
  async receivable(
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<ICashflowReport['receivable']> {
    const today = financeToday(now);
    const tomorrow = new Date(moscowStart(today).getTime() + DAY_MS);
    const rows = await this.operations.receivableByArticle(telegramUserId, tomorrow);
    return { asOf: today, ...receivableOf(rows) };
  }
}
