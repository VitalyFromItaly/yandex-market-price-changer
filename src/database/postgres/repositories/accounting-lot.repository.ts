import type { ILotDraft } from '../../../modules/accounting/accounting-lots.domain';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { accountingLots, financePurchases } from '../finance.schema';

export type TAccountingLotRow = typeof accountingLots.$inferSelect;

/** Партия с поставщиком своей закупки — для экрана партий (TASK-216). */
export type TAccountingLotWithSupplier = TAccountingLotRow & { supplier: string };

const l = accountingLots;

/**
 * Партии «Финучёта» (TASK-214). Скоуп — telegramUserId в каждом условии. Партии
 * закупки только пересоздаются целиком (`replaceForPurchase`) в транзакции её
 * сохранения; удаление закупки снимает их каскадом FK.
 */
@Injectable()
export class AccountingLotRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  /** Партии закупки заменяются черновиками; возвращает записанные строки. */
  async replaceForPurchase(
    telegramUserId: string,
    purchaseId: string,
    drafts: readonly ILotDraft[],
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingLotRow[]> {
    await executor
      .delete(l)
      .where(and(eq(l.telegramUserId, telegramUserId), eq(l.purchaseId, purchaseId)));
    if (!drafts.length) return [];
    return executor
      .insert(l)
      .values(drafts.map((draft) => ({ telegramUserId, purchaseId, ...draft })))
      .returning();
  }

  /** Партии продавца в порядке поступления (под FIFO). */
  listForUser(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingLotRow[]> {
    return executor
      .select()
      .from(l)
      .where(eq(l.telegramUserId, telegramUserId))
      .orderBy(asc(l.receivedDay), asc(l.createdAt), asc(l.purchaseId), asc(l.lineIndex));
  }

  /** То же, что `listForUser` (тот же порядок — под FIFO), плюс поставщик закупки. */
  async listForUserWithSupplier(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingLotWithSupplier[]> {
    const rows = await executor
      .select({ lot: l, supplier: financePurchases.supplier })
      .from(l)
      .innerJoin(financePurchases, eq(financePurchases.id, l.purchaseId))
      .where(eq(l.telegramUserId, telegramUserId))
      .orderBy(asc(l.receivedDay), asc(l.createdAt), asc(l.purchaseId), asc(l.lineIndex));
    return rows.map((row) => ({ ...row.lot, supplier: row.supplier }));
  }

  forPurchase(
    telegramUserId: string,
    purchaseId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingLotRow[]> {
    return executor
      .select()
      .from(l)
      .where(and(eq(l.telegramUserId, telegramUserId), eq(l.purchaseId, purchaseId)))
      .orderBy(asc(l.lineIndex));
  }
}
