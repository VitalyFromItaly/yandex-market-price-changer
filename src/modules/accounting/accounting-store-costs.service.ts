import type { TAllocationMethod } from './store-cost-allocation';
import type { IAccountingExpense } from '../finance/finance-expenses.service';
import type { IFinancePeriod } from '../finance/finance-period';

import { Injectable } from '@nestjs/common';

import { labelResolver } from '../finance/expense.domain';
import { FinanceExpensesService } from '../finance/finance-expenses.service';

import { AccountingAllocationSettingsService } from './accounting-allocation-settings.service';
import { isStoreLevelExpense } from './expense-binding-allocation';

/** Расходы продавца месяца, разложенные для карточки заказа. */
export interface IAccountingMonthExpenses {
  /** Весь бизнес и площадка — идут в общие расходы по методике. */
  storeLevel: IAccountingExpense[];
  /** Заказ и товар — «Прочие расходы» своих заказов. */
  bound: IAccountingExpense[];
  /** Подпись расхода — его категория (своя — по имени, удалённая — «Без категории»). */
  titleOf: (expense: IAccountingExpense) => string;
}

/**
 * Вход распределения общих расходов «Финучёта» продавца (TASK-219/220): методика и
 * расходы из «Расходов». Одна дверь для карточки заказа, чтобы ей не собирать это
 * из двух сервисов самой.
 */
@Injectable()
export class AccountingStoreCostsService {
  constructor(
    private readonly settings: AccountingAllocationSettingsService,
    private readonly expenses: FinanceExpensesService,
  ) {}

  methodOf(telegramUserId: string): Promise<TAllocationMethod> {
    return this.settings.methodOf(telegramUserId);
  }

  async expensesOf(
    telegramUserId: string,
    month: IFinancePeriod,
  ): Promise<IAccountingMonthExpenses> {
    const [rows, snapshot] = await Promise.all([
      this.expenses.forAccounting(telegramUserId, month),
      this.expenses.snapshot(telegramUserId),
    ]);
    const labelOf = labelResolver(snapshot.categories);
    return {
      storeLevel: rows.filter(isStoreLevelExpense),
      bound: rows.filter((e) => !isStoreLevelExpense(e)),
      titleOf: (e) => labelOf(e.row.category),
    };
  }
}
