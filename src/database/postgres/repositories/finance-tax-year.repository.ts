import type {
  ITaxReconciliationValue,
  ITaxReductionValue,
  ITaxYearParams,
  TTaxYearPeriod,
} from '../../../modules/finance/tax-year.domain';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import {
  financeTaxReconciliations,
  financeTaxReductions,
  financeTaxYears,
} from '../finance.schema';

export type TFinanceTaxYearRow = typeof financeTaxYears.$inferSelect;
export type TFinanceTaxReductionRow = typeof financeTaxReductions.$inferSelect;
export type TFinanceTaxReconciliationRow = typeof financeTaxReconciliations.$inferSelect;

const y = financeTaxYears;
const r = financeTaxReductions;
const c = financeTaxReconciliations;

/**
 * Налоговый модуль ИП (TASK-146): параметры лет (общие на всех), уменьшения и
 * сверки продавца. Запросы продавца фильтруются по `telegramUserId` — чужая
 * запись для него не существует (довод `FinancePurchaseRepository`).
 */
@Injectable()
export class FinanceTaxYearRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  listYears(executor: TFinanceExecutor = this.db): Promise<TFinanceTaxYearRow[]> {
    return executor.select().from(y).orderBy(desc(y.year));
  }

  async findYear(
    year: number,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxYearRow | null> {
    const [row] = await executor.select().from(y).where(eq(y.year, year));
    return row ?? null;
  }

  async upsertYear(
    value: ITaxYearParams,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxYearRow> {
    const { year, ...fields } = value;
    const [row] = await executor
      .insert(y)
      .values(value)
      .onConflictDoUpdate({ target: y.year, set: { ...fields, updatedAt: new Date() } })
      .returning();
    return row;
  }

  listReductions(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxReductionRow[]> {
    return executor
      .select()
      .from(r)
      .where(eq(r.telegramUserId, telegramUserId))
      .orderBy(desc(r.paidDay), desc(r.createdAt));
  }

  reductionsBetween(
    telegramUserId: string,
    fromDay: string,
    toDay: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxReductionRow[]> {
    return executor
      .select()
      .from(r)
      .where(
        and(eq(r.telegramUserId, telegramUserId), gte(r.paidDay, fromDay), lte(r.paidDay, toDay)),
      )
      .orderBy(asc(r.paidDay), asc(r.createdAt));
  }

  async createReduction(
    telegramUserId: string,
    value: ITaxReductionValue,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxReductionRow> {
    const [row] = await executor
      .insert(r)
      .values({ telegramUserId, ...value })
      .returning();
    return row;
  }

  async updateReduction(
    telegramUserId: string,
    id: string,
    value: ITaxReductionValue,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxReductionRow | null> {
    const [row] = await executor
      .update(r)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(r.telegramUserId, telegramUserId), eq(r.id, id)))
      .returning();
    return row ?? null;
  }

  async removeReduction(
    telegramUserId: string,
    id: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .delete(r)
      .where(and(eq(r.telegramUserId, telegramUserId), eq(r.id, id)))
      .returning({ id: r.id });
    return rows.length > 0;
  }

  reconciliations(
    telegramUserId: string,
    year: number,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxReconciliationRow[]> {
    return executor
      .select()
      .from(c)
      .where(and(eq(c.telegramUserId, telegramUserId), eq(c.year, year)));
  }

  /**
   * Сверка периода. `checkedAt` — момент, когда отметку поставили: снятие
   * обнуляет его, повторная отметка уже сверенного не сдвигает.
   */
  async upsertReconciliation(
    telegramUserId: string,
    year: number,
    period: TTaxYearPeriod,
    value: ITaxReconciliationValue,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxReconciliationRow> {
    const [existing] = await executor
      .select({ checked: c.checked, checkedAt: c.checkedAt })
      .from(c)
      .where(and(eq(c.telegramUserId, telegramUserId), eq(c.year, year), eq(c.period, period)));
    const now = new Date();
    let checkedAt: Date | null = null;
    if (value.checked) checkedAt = existing?.checked ? existing.checkedAt : now;
    const fields = { ...value, checkedAt, updatedAt: now };
    const [row] = await executor
      .insert(c)
      .values({ telegramUserId, year, period, ...fields })
      .onConflictDoUpdate({ target: [c.telegramUserId, c.year, c.period], set: fields })
      .returning();
    return row;
  }
}
