import type { IFinancePeriodState } from '../../../modules/finance/finance-period-status';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';
import type { TFinanceMarketplace } from '../finance.schema';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { financePeriods } from '../finance.schema';

export interface IFinancePeriodKey {
  marketplace: TFinanceMarketplace;
  telegramUserId: string;
  periodKey: string;
}

export interface IFinancePeriodInput extends IFinancePeriodKey, IFinancePeriodState {
  reportType: string;
  periodFrom: string;
  periodTo: string;
  checkedAt: Date;
}

export type TFinancePeriodRow = typeof financePeriods.$inferSelect;

const t = financePeriods;

/**
 * Статусы периодов (TASK-112). Пишет загрузка после каждой попытки, читают
 * карточка «Очереди» и (с TASK-124) экран «Финансы». Скоуп — telegramUserId в
 * каждом условии.
 */
@Injectable()
export class FinancePeriodRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  async find(
    key: IFinancePeriodKey,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinancePeriodRow | null> {
    const [found] = await executor
      .select()
      .from(t)
      .where(
        and(
          eq(t.marketplace, key.marketplace),
          eq(t.telegramUserId, key.telegramUserId),
          eq(t.periodKey, key.periodKey),
        ),
      );
    return found ?? null;
  }

  /** Одна строка на период: вставка или полная замена состояния. */
  async upsert(
    input: IFinancePeriodInput,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinancePeriodRow> {
    const state = {
      status: input.status,
      lastOutcome: input.lastOutcome,
      documentVersion: input.documentVersion,
      unknownCount: input.unknownCount,
      changedCount: input.changedCount,
      removedCount: input.removedCount,
      discrepancyCount: input.discrepancyCount,
      reconcileState: input.reconcileState,
      reconcileNote: input.reconcileNote,
      error: input.error,
      checkedAt: input.checkedAt,
    };
    const [row] = await executor
      .insert(t)
      .values({
        marketplace: input.marketplace,
        telegramUserId: input.telegramUserId,
        reportType: input.reportType,
        periodKey: input.periodKey,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        ...state,
      })
      .onConflictDoUpdate({
        target: [t.marketplace, t.telegramUserId, t.periodKey],
        set: { ...state, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  /** Периоды продавцов — новые сверху; пустой список id — пустой ответ без запроса. */
  async listByUsers(telegramUserIds: readonly string[]): Promise<TFinancePeriodRow[]> {
    if (!telegramUserIds.length) return [];
    return await this.db
      .select()
      .from(t)
      .where(inArray(t.telegramUserId, [...telegramUserIds]))
      .orderBy(desc(t.periodFrom));
  }
}
