import type { IExpenseValue, IRegistryAccrual } from '../../../modules/finance/expense.domain';
import type { TFinanceArticle } from '../../../modules/finance/finance-articles';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gte, isNull, lt, lte } from 'drizzle-orm';

import { financeToday } from '../../../modules/finance/finance-period';
import { breakdownOf } from '../../../modules/finance/operation-breakdown';
import { FINANCE_DB } from '../finance-db';
import {
  accountingManualOperations,
  financeExpenseCategories,
  financeExpenses,
  financeOperations,
} from '../finance.schema';

export type TFinanceExpenseRow = typeof financeExpenses.$inferSelect;
export type TFinanceExpenseCategoryRow = typeof financeExpenseCategories.$inferSelect;

const e = financeExpenses;
const c = financeExpenseCategories;

/** Проверенный расход и статья реестра, которую он повторяет (TASK-220). */
export interface IExpenseWrite extends IExpenseValue {
  doubleCountArticle: TFinanceArticle | null;
}

const DAY_MS = 86_400_000;
const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

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
    value: IExpenseWrite,
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
    value: IExpenseWrite,
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

  /**
   * Начисления реестра «Финучёта» за дни [from, to] — вход проверки двойного
   * учёта (`doubleCountArticleOf`): живые строки журнала всех площадок (сводная —
   * каждой статьёй своей расшифровки) и живые ручные операции. Только статьи из
   * `articles`: подписка/реклама/хранение — не весь журнал месяца.
   */
  async registryAccruals(
    telegramUserId: string,
    window: { from: string; to: string },
    articles: readonly TFinanceArticle[],
    executor: TFinanceExecutor = this.db,
  ): Promise<IRegistryAccrual[]> {
    if (!articles.length) return [];
    const wanted = new Set(articles);
    const o = financeOperations;
    const m = accountingManualOperations;
    const [journal, manual] = await Promise.all([
      executor
        .select({
          article: o.article,
          breakdown: o.breakdown,
          marketplace: o.marketplace,
          accruedAt: o.accruedAt,
        })
        .from(o)
        .where(
          and(
            eq(o.telegramUserId, telegramUserId),
            isNull(o.supersededAt),
            gte(o.accruedAt, moscowStart(window.from)),
            lt(o.accruedAt, new Date(moscowStart(window.to).getTime() + DAY_MS)),
          ),
        ),
      executor
        .select({ article: m.article, marketplace: m.marketplace, accruedOn: m.accruedOn })
        .from(m)
        .where(
          and(
            eq(m.telegramUserId, telegramUserId),
            isNull(m.deletedAt),
            gte(m.accruedOn, window.from),
            lte(m.accruedOn, window.to),
          ),
        ),
    ]);
    const result: IRegistryAccrual[] = [];
    for (const row of journal) {
      const parts = breakdownOf(row.breakdown)?.map((part) => part.article) ?? [row.article];
      const accruedOn = financeToday(row.accruedAt);
      for (const article of new Set(parts)) {
        if (wanted.has(article)) result.push({ article, marketplace: row.marketplace, accruedOn });
      }
    }
    for (const row of manual) {
      if (wanted.has(row.article)) result.push(row);
    }
    return result;
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
