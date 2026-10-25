import type { IFinanceCorrectionPair } from '../../../modules/finance/finance-corrections';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';
import type { TFinanceMarketplace } from '../finance.schema';

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { financeCorrections } from '../finance.schema';

/** Потолок страницы: без него `?limit=1000000` выгребает таблицу в память. */
export const MAX_FINANCE_CORRECTIONS_PAGE = 100;

export interface IFinanceCorrectionsContext {
  marketplace: TFinanceMarketplace;
  telegramUserId: string;
  businessId: string;
  periodKey: string;
  documentId: string;
  documentVersion: number;
}

export interface IFinanceCorrectionsQuery {
  telegramUserId?: string;
  /** Площадка журнала (TASK-180); не задана — все. */
  marketplace?: TFinanceMarketplace;
  /** Только корректировки периода (`financePeriodKey`) — экран «Финансы» месяца. */
  periodKey?: string;
  limit?: number;
  skip?: number;
}

export type TFinanceCorrectionRow = typeof financeCorrections.$inferSelect;

const t = financeCorrections;

/**
 * Корректировки журнала — что Маркет поменял в новой версии отчёта периода.
 * Пишет только импорт (в своей транзакции), читает админка.
 */
@Injectable()
export class FinanceCorrectionRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  async record(
    ctx: IFinanceCorrectionsContext,
    pairs: readonly IFinanceCorrectionPair[],
    executor: TFinanceExecutor = this.db,
  ): Promise<number> {
    if (!pairs.length) return 0;
    await executor.insert(t).values(pairs.map((pair) => ({ ...ctx, ...pair })));
    return pairs.length;
  }

  async list(
    query: IFinanceCorrectionsQuery,
  ): Promise<{ items: TFinanceCorrectionRow[]; total: number }> {
    const where = and(
      query.telegramUserId ? eq(t.telegramUserId, query.telegramUserId) : undefined,
      query.periodKey ? eq(t.periodKey, query.periodKey) : undefined,
      query.marketplace ? eq(t.marketplace, query.marketplace) : undefined,
    );
    const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_FINANCE_CORRECTIONS_PAGE);
    const offset = Math.max(query.skip ?? 0, 0);

    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(t).where(where).orderBy(desc(t.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(t).where(where),
    ]);
    return { items, total };
  }

  /** Корректировки, найденные импортом версии, — по видам (счётчики статуса периода). */
  async countByDocument(
    telegramUserId: string,
    documentId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<{ changed: number; removed: number }> {
    const rows = await executor
      .select({ kind: t.kind, total: count() })
      .from(t)
      .where(and(eq(t.telegramUserId, telegramUserId), eq(t.documentId, documentId)))
      .groupBy(t.kind);
    const of = (kind: string) => rows.find((r) => r.kind === kind)?.total ?? 0;
    return { changed: of('changed'), removed: of('removed') };
  }
}
