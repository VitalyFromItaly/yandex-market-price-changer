import type { IExpenseValue } from '../../../modules/finance/expense.domain';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { financeExpenseCategories, financeExpenses } from '../finance.schema';

export type TFinanceExpenseRow = typeof financeExpenses.$inferSelect;
export type TFinanceExpenseCategoryRow = typeof financeExpenseCategories.$inferSelect;

const e = financeExpenses;
const c = financeExpenseCategories;

/**
 * Операционные расходы продавца и его свои категории (TASK-121). Каждый
 * запрос фильтруется по `telegramUserId`: чужая запись для продавца не
 * существует — `null`/`false`, а не чужие данные.
 */
@Injectable()
export class FinanceExpenseRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  list(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceExpenseRow[]> {
    return executor
      .select()
      .from(e)
      .where(eq(e.telegramUserId, telegramUserId))
      .orderBy(asc(e.fromDay), asc(e.createdAt));
  }

  async create(
    telegramUserId: string,
    value: IExpenseValue,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceExpenseRow> {
    const [row] = await executor
      .insert(e)
      .values({ telegramUserId, ...value })
      .returning();
    return row;
  }

  async update(
    telegramUserId: string,
    id: string,
    value: IExpenseValue,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceExpenseRow | null> {
    const [row] = await executor
      .update(e)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(e.telegramUserId, telegramUserId), eq(e.id, id)))
      .returning();
    return row ?? null;
  }

  async remove(
    telegramUserId: string,
    id: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .delete(e)
      .where(and(eq(e.telegramUserId, telegramUserId), eq(e.id, id)))
      .returning({ id: e.id });
    return rows.length > 0;
  }

  async countByCategory(
    telegramUserId: string,
    category: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<number> {
    const [{ total }] = await executor
      .select({ total: count() })
      .from(e)
      .where(and(eq(e.telegramUserId, telegramUserId), eq(e.category, category)));
    return total;
  }

  listCategories(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceExpenseCategoryRow[]> {
    return executor
      .select()
      .from(c)
      .where(eq(c.telegramUserId, telegramUserId))
      .orderBy(asc(c.createdAt));
  }

  async createCategory(
    telegramUserId: string,
    name: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceExpenseCategoryRow> {
    const [row] = await executor.insert(c).values({ telegramUserId, name }).returning();
    return row;
  }

  async removeCategory(
    telegramUserId: string,
    id: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .delete(c)
      .where(and(eq(c.telegramUserId, telegramUserId), eq(c.id, id)))
      .returning({ id: c.id });
    return rows.length > 0;
  }
}
