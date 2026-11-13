import type { IFinancePeriod } from '../../../modules/finance/finance-period';
import type { IOzonPeriodBalance } from '../../../modules/ozon/ozon.client';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { financeOzonBalances } from '../finance.schema';

const t = financeOzonBalances;

/**
 * Сальдо Ozon за закрытый месяц (TASK-227) — документ сверки v2. Пишет импорт
 * Ozon, читает сверка. Скоуп — telegramUserId в каждом условии.
 */
@Injectable()
export class FinanceOzonBalanceRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  /** Записать сальдо месяца — повторная загрузка заменяет прежнее. */
  async upsert(
    telegramUserId: string,
    period: IFinancePeriod,
    balance: IOzonPeriodBalance,
    loadedAt: Date,
    executor: TFinanceExecutor = this.db,
  ): Promise<void> {
    await executor
      .insert(t)
      .values({
        telegramUserId,
        periodFrom: period.from,
        periodTo: period.to,
        ...balance,
        loadedAt,
      })
      .onConflictDoUpdate({
        target: [t.telegramUserId, t.periodFrom, t.periodTo],
        set: {
          openingKopecks: sql`excluded.opening_kopecks`,
          accruedKopecks: sql`excluded.accrued_kopecks`,
          paymentsKopecks: sql`excluded.payments_kopecks`,
          closingKopecks: sql`excluded.closing_kopecks`,
          loadedAt: sql`excluded.loaded_at`,
        },
      });
  }

  /** Сальдо месяца; null — не загружено. */
  async of(
    telegramUserId: string,
    period: IFinancePeriod,
    executor: TFinanceExecutor = this.db,
  ): Promise<IOzonPeriodBalance | null> {
    const [row] = await executor
      .select({
        openingKopecks: t.openingKopecks,
        accruedKopecks: t.accruedKopecks,
        paymentsKopecks: t.paymentsKopecks,
        closingKopecks: t.closingKopecks,
      })
      .from(t)
      .where(
        and(
          eq(t.telegramUserId, telegramUserId),
          eq(t.periodFrom, period.from),
          eq(t.periodTo, period.to),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}
