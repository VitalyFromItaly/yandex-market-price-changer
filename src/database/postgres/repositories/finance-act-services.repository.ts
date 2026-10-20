import type { IYmActServicesTotal } from '../../../modules/finance/ym-act-breakdown';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { financeActServices } from '../finance.schema';

const t = financeActServices;

export interface IFinanceActServices {
  totalKopecks: number;
  /** null — итог ещё не сверялся с журналом. */
  journalMatched: boolean | null;
}

/**
 * Итоги актов в отчёте услуг (TASK-158). Пишет импорт, читает сверка. Скоуп —
 * telegramUserId в каждом условии; площадка пока одна — ЯМ.
 */
@Injectable()
export class FinanceActServicesRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  /** Записать итоги — повторная загрузка того же акта заменяет прежний итог. */
  async upsertMany(
    telegramUserId: string,
    totals: readonly IYmActServicesTotal[],
    loadedAt: Date,
    executor: TFinanceExecutor = this.db,
  ): Promise<void> {
    if (!totals.length) return;
    await executor
      .insert(t)
      .values(
        totals.map((total) => ({
          marketplace: 'ym' as const,
          telegramUserId,
          actDay: total.actDay,
          totalKopecks: total.totalKopecks,
          sheets: total.sheets,
          loadedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [t.marketplace, t.telegramUserId, t.actDay],
        set: {
          totalKopecks: sql`excluded.total_kopecks`,
          sheets: sql`excluded.sheets`,
          loadedAt: sql`excluded.loaded_at`,
          // Новый итог ещё не сверялся с журналом.
          journalMatched: sql`NULL`,
          updatedAt: sql`now()`,
        },
      });
  }

  /** День акта → итог услуг (копейки) и исход последней сверки. Акта без итога в карте нет. */
  async byDays(
    telegramUserId: string,
    actDays: readonly string[],
    executor: TFinanceExecutor = this.db,
  ): Promise<Map<string, IFinanceActServices>> {
    const result = new Map<string, IFinanceActServices>();
    if (!actDays.length) return result;
    const rows = await executor
      .select({
        actDay: t.actDay,
        totalKopecks: t.totalKopecks,
        journalMatched: t.journalMatched,
      })
      .from(t)
      .where(
        and(
          eq(t.marketplace, 'ym'),
          eq(t.telegramUserId, telegramUserId),
          inArray(t.actDay, [...actDays]),
        ),
      );
    for (const row of rows) {
      result.set(row.actDay, {
        totalKopecks: row.totalKopecks,
        journalMatched: row.journalMatched,
      });
    }
    return result;
  }

  /** Записать исход сверки акта с журналом — по нему импорт решает, перезаказать ли отчёт. */
  async markMatched(
    telegramUserId: string,
    matched: ReadonlyMap<string, boolean>,
    executor: TFinanceExecutor = this.db,
  ): Promise<void> {
    for (const value of [true, false]) {
      const days = [...matched].filter(([, m]) => m === value).map(([day]) => day);
      if (!days.length) continue;
      await executor
        .update(t)
        .set({ journalMatched: value, updatedAt: new Date() })
        .where(
          and(
            eq(t.marketplace, 'ym'),
            eq(t.telegramUserId, telegramUserId),
            inArray(t.actDay, days),
          ),
        );
    }
  }
}
