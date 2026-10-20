import type { IExpenseAllocation } from './expense-allocation';
import type { TExpenseField } from './expense.domain';
import type { IFinancePeriod } from './finance-period';
import type {
  TFinanceExpenseCategoryRow,
  TFinanceExpenseRow,
} from '../../database/postgres/repositories/finance-expense.repository';

import { Injectable } from '@nestjs/common';

import { FinanceExpenseRepository } from '../../database/postgres/repositories/finance-expense.repository';

import { allocate } from './expense-allocation';
import { isUuid, validateCategoryName, validateExpenseInput } from './expense.domain';
import { assertFinancePeriod } from './finance-period';

/** Ввод расхода не прошёл проверку — `field` говорит, под каким полем показать. */
export class ExpenseValidationError extends Error {
  constructor(
    readonly field: TExpenseField | 'name' | 'period',
    message: string,
  ) {
    super(message);
    this.name = 'ExpenseValidationError';
  }
}

/** Записи нет — или она чужая: для продавца это одно и то же. */
export class ExpenseNotFoundError extends Error {
  constructor(message = 'Запись не найдена') {
    super(message);
    this.name = 'ExpenseNotFoundError';
  }
}

/** Своя категория занята записями — удалить её значит оставить их без категории. */
export class ExpenseCategoryInUseError extends Error {
  constructor(readonly used: number) {
    super(`Категория используется в записях: ${used}. Сначала перенесите или удалите их`);
    this.name = 'ExpenseCategoryInUseError';
  }
}

export interface IExpensesSnapshot {
  expenses: TFinanceExpenseRow[];
  categories: TFinanceExpenseCategoryRow[];
}

/**
 * Операционные расходы бизнеса (TASK-121). Единственная дверь к ним: CRM
 * правит записи через неё, движок P&L (TASK-120) берёт `allocatedFor`.
 * Ничего не кэшируется — правка расхода видна в следующем же расчёте.
 */
@Injectable()
export class FinanceExpensesService {
  constructor(private readonly repository: FinanceExpenseRepository) {}

  async snapshot(telegramUserId: string): Promise<IExpensesSnapshot> {
    const [expenses, categories] = await Promise.all([
      this.repository.list(telegramUserId),
      this.repository.listCategories(telegramUserId),
    ]);
    return { expenses, categories };
  }

  async create(
    telegramUserId: string,
    input: Record<string, unknown>,
  ): Promise<TFinanceExpenseRow> {
    const value = await this.validated(telegramUserId, input);
    return this.repository.create(telegramUserId, value);
  }

  async update(
    telegramUserId: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<TFinanceExpenseRow> {
    if (!isUuid(id)) throw new ExpenseNotFoundError();
    const value = await this.validated(telegramUserId, input);
    const row = await this.repository.update(telegramUserId, id, value);
    if (!row) throw new ExpenseNotFoundError();
    return row;
  }

  async remove(telegramUserId: string, id: string): Promise<void> {
    if (!isUuid(id) || !(await this.repository.remove(telegramUserId, id))) {
      throw new ExpenseNotFoundError();
    }
  }

  async addCategory(telegramUserId: string, name: unknown): Promise<TFinanceExpenseCategoryRow> {
    const existing = await this.repository.listCategories(telegramUserId);
    const checked = validateCategoryName(
      name,
      existing.map((row) => row.name),
    );
    if (checked.ok === false) throw new ExpenseValidationError('name', checked.error);
    return this.repository.createCategory(telegramUserId, checked.value);
  }

  async removeCategory(telegramUserId: string, id: string): Promise<void> {
    if (!isUuid(id)) throw new ExpenseNotFoundError('Категория не найдена');
    const used = await this.repository.countByCategory(telegramUserId, id);
    if (used) throw new ExpenseCategoryInUseError(used);
    if (!(await this.repository.removeCategory(telegramUserId, id))) {
      throw new ExpenseNotFoundError('Категория не найдена');
    }
  }

  /** Расходы продавца на период — то, что вычтет P&L (TASK-120). */
  async allocatedFor(telegramUserId: string, period: IFinancePeriod): Promise<IExpenseAllocation> {
    try {
      assertFinancePeriod(period);
    } catch (error) {
      throw new ExpenseValidationError('period', (error as Error).message);
    }
    return allocate(await this.repository.list(telegramUserId), period);
  }

  private async validated(telegramUserId: string, input: Record<string, unknown>) {
    const categories = await this.repository.listCategories(telegramUserId);
    const checked = validateExpenseInput(input, new Set(categories.map((row) => row.id)));
    if (checked.ok === false) throw new ExpenseValidationError(checked.field, checked.error);
    return checked.value;
  }
}
