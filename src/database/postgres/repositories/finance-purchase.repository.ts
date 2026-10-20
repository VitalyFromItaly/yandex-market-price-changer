import type { IPurchaseValue, ITaxPaymentValue } from '../../../modules/finance/purchase.domain';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { financePurchases, financeTaxPayments } from '../finance.schema';

export type TFinancePurchaseRow = typeof financePurchases.$inferSelect;
export type TFinanceTaxPaymentRow = typeof financeTaxPayments.$inferSelect;

const p = financePurchases;
const tp = financeTaxPayments;

/**
 * Закупки партий и уплаченные налоги продавца (TASK-122). Каждый запрос
 * фильтруется по `telegramUserId`: чужая запись для продавца не существует —
 * `null`/`false`, а не чужие данные (довод `FinanceExpenseRepository`).
 */
@Injectable()
export class FinancePurchaseRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  listPurchases(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinancePurchaseRow[]> {
    return executor
      .select()
      .from(p)
      .where(eq(p.telegramUserId, telegramUserId))
      .orderBy(desc(p.paidDay), desc(p.createdAt));
  }

  /** Закупки, оплаченные в дни `fromDay…toDay` включительно. */
  purchasesBetween(
    telegramUserId: string,
    fromDay: string,
    toDay: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinancePurchaseRow[]> {
    return executor
      .select()
      .from(p)
      .where(
        and(eq(p.telegramUserId, telegramUserId), gte(p.paidDay, fromDay), lte(p.paidDay, toDay)),
      )
      .orderBy(asc(p.paidDay), asc(p.createdAt));
  }

  async createPurchase(
    telegramUserId: string,
    value: IPurchaseValue,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinancePurchaseRow> {
    const [row] = await executor
      .insert(p)
      .values({ telegramUserId, ...value })
      .returning();
    return row;
  }

  async updatePurchase(
    telegramUserId: string,
    id: string,
    value: IPurchaseValue,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinancePurchaseRow | null> {
    const [row] = await executor
      .update(p)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(p.telegramUserId, telegramUserId), eq(p.id, id)))
      .returning();
    return row ?? null;
  }

  async removePurchase(
    telegramUserId: string,
    id: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .delete(p)
      .where(and(eq(p.telegramUserId, telegramUserId), eq(p.id, id)))
      .returning({ id: p.id });
    return rows.length > 0;
  }

  listTaxPayments(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxPaymentRow[]> {
    return executor
      .select()
      .from(tp)
      .where(eq(tp.telegramUserId, telegramUserId))
      .orderBy(desc(tp.paidDay), desc(tp.createdAt));
  }

  taxPaymentsBetween(
    telegramUserId: string,
    fromDay: string,
    toDay: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxPaymentRow[]> {
    return executor
      .select()
      .from(tp)
      .where(
        and(
          eq(tp.telegramUserId, telegramUserId),
          gte(tp.paidDay, fromDay),
          lte(tp.paidDay, toDay),
        ),
      )
      .orderBy(asc(tp.paidDay), asc(tp.createdAt));
  }

  async createTaxPayment(
    telegramUserId: string,
    value: ITaxPaymentValue,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxPaymentRow> {
    const [row] = await executor
      .insert(tp)
      .values({ telegramUserId, ...value })
      .returning();
    return row;
  }

  async updateTaxPayment(
    telegramUserId: string,
    id: string,
    value: ITaxPaymentValue,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxPaymentRow | null> {
    const [row] = await executor
      .update(tp)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(tp.telegramUserId, telegramUserId), eq(tp.id, id)))
      .returning();
    return row ?? null;
  }

  async removeTaxPayment(
    telegramUserId: string,
    id: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<boolean> {
    const rows = await executor
      .delete(tp)
      .where(and(eq(tp.telegramUserId, telegramUserId), eq(tp.id, id)))
      .returning({ id: tp.id });
    return rows.length > 0;
  }
}
