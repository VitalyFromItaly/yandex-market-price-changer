import type { IReconcileFinding, TReconcileKind } from '../../../modules/finance/finance-reconcile';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';
import type { TFinanceMarketplace } from '../finance.schema';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { financeDiscrepancies } from '../finance.schema';

/** Потолок страницы — довод MAX_FINANCE_CORRECTIONS_PAGE. */
export const MAX_FINANCE_DISCREPANCIES_PAGE = 100;

export interface IFinanceDiscrepanciesScope {
  marketplace: TFinanceMarketplace;
  telegramUserId: string;
  periodKey: string;
}

export interface IFinanceDiscrepanciesQuery {
  telegramUserId?: string;
  periodKey?: string;
  limit?: number;
  skip?: number;
}

export type TFinanceDiscrepancyRow = typeof financeDiscrepancies.$inferSelect;

/** Сколько находок в одном INSERT: строка — 12 параметров, до потолка 65 535 далеко. */
const INSERT_CHUNK_SIZE = 1000;

const t = financeDiscrepancies;

/**
 * Находки сверки периода (TASK-113). Пишет только сверка, читает админка.
 * Скоуп — telegramUserId в каждом условии.
 */
@Injectable()
export class FinanceDiscrepancyRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  /**
   * Заменить находки периода целиком — удаление и вставка одной транзакцией:
   * между ними панель не увидит «расхождений нет».
   */
  async replacePeriod(
    scope: IFinanceDiscrepanciesScope,
    findings: readonly IReconcileFinding[],
  ): Promise<number> {
    await this.db.transaction(async (tx) => {
      await this.deletePeriod(scope, tx);
      for (let i = 0; i < findings.length; i += INSERT_CHUNK_SIZE) {
        await tx.insert(t).values(
          findings.slice(i, i + INSERT_CHUNK_SIZE).map((f) => ({
            ...scope,
            kind: f.kind,
            orderId: f.orderId ?? null,
            bankOrderId: f.bankOrderId ?? null,
            operationIds: f.operationIds,
            operationCount: f.operationCount,
            expectedKopecks: f.expectedKopecks ?? null,
            actualKopecks: f.actualKopecks ?? null,
            detail: f.detail,
          })),
        );
      }
    });
    return findings.length;
  }

  private async deletePeriod(
    scope: IFinanceDiscrepanciesScope,
    executor: TFinanceExecutor,
  ): Promise<void> {
    await executor
      .delete(t)
      .where(
        and(
          eq(t.marketplace, scope.marketplace),
          eq(t.telegramUserId, scope.telegramUserId),
          eq(t.periodKey, scope.periodKey),
        ),
      );
  }

  /** Все находки периода — детектору аномалий (TASK-149); страница `list` упирается в 100. */
  async allOfPeriod(scope: IFinanceDiscrepanciesScope): Promise<TFinanceDiscrepancyRow[]> {
    return await this.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.marketplace, scope.marketplace),
          eq(t.telegramUserId, scope.telegramUserId),
          eq(t.periodKey, scope.periodKey),
        ),
      )
      .orderBy(asc(t.kind), asc(t.orderId), asc(t.bankOrderId));
  }

  /**
   * Находки одного вида у нескольких продавцов — карточка «Загрузка финансов»
   * показывает, какой акт не сошёлся (TASK-158). Один запрос на карточку.
   */
  async listByKind(
    telegramUserIds: readonly string[],
    kind: TReconcileKind,
  ): Promise<TFinanceDiscrepancyRow[]> {
    if (!telegramUserIds.length) return [];
    return await this.db
      .select()
      .from(t)
      .where(and(inArray(t.telegramUserId, [...telegramUserIds]), eq(t.kind, kind)))
      .orderBy(asc(t.periodKey), asc(t.detail));
  }

  async list(
    query: IFinanceDiscrepanciesQuery,
  ): Promise<{ items: TFinanceDiscrepancyRow[]; total: number }> {
    const where = and(
      query.telegramUserId ? eq(t.telegramUserId, query.telegramUserId) : undefined,
      query.periodKey ? eq(t.periodKey, query.periodKey) : undefined,
    );
    const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_FINANCE_DISCREPANCIES_PAGE);
    const offset = Math.max(query.skip ?? 0, 0);

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(t)
        .where(where)
        .orderBy(asc(t.periodKey), asc(t.kind), asc(t.orderId))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(t).where(where),
    ]);
    return { items, total };
  }
}
