import type {
  IFinanceSyncPeriodState,
  TFinanceSyncOutcome,
  TFinanceSyncTrigger,
} from '../../../modules/finance/finance-sync';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';
import type { TFinanceMarketplace } from '../finance.schema';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, max, sql } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { financeSyncRuns } from '../finance.schema';

export interface IFinanceSyncRunInput {
  marketplace: TFinanceMarketplace;
  telegramUserId: string;
  periodKey: string;
  periodFrom: string;
  periodTo: string;
  trigger: TFinanceSyncTrigger;
  attempt: number;
  outcome: TFinanceSyncOutcome;
  error?: string | null;
  startedAt: Date;
  finishedAt: Date;
}

const t = financeSyncRuns;

/** Исходы-успехи — в SQL, тем же списком, что `isSyncSuccess`. */
const SUCCESS_OUTCOMES: TFinanceSyncOutcome[] = ['empty', 'unchanged', 'imported'];

/**
 * Журнал синхронизации финансов (TASK-212). Пишет процессор finance-import на
 * каждую попытку периода, читают экран «Финучёта», контроль пропусков и
 * правило уведомления о сбое. Скоуп — telegramUserId в каждом условии.
 */
@Injectable()
export class FinanceSyncRunRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  async record(run: IFinanceSyncRunInput, executor: TFinanceExecutor = this.db): Promise<void> {
    await executor.insert(t).values({ ...run, error: run.error ?? null });
  }

  /**
   * Последнее состояние каждого периода продавца: последняя попытка
   * (`DISTINCT ON` по периоду, свежая первой) и отдельно — время последнего
   * успеха. Площадки — фильтр, пусто — все.
   */
  async states(
    telegramUserId: string,
    marketplaces: readonly TFinanceMarketplace[] = [],
    executor: TFinanceExecutor = this.db,
  ): Promise<IFinanceSyncPeriodState[]> {
    const scope = and(
      eq(t.telegramUserId, telegramUserId),
      ...(marketplaces.length ? [inArray(t.marketplace, [...marketplaces])] : []),
    );
    const [latest, successes] = await Promise.all([
      executor
        .selectDistinctOn([t.marketplace, t.periodKey], {
          marketplace: t.marketplace,
          periodKey: t.periodKey,
          from: t.periodFrom,
          to: t.periodTo,
          lastAttemptAt: t.finishedAt,
          lastOutcome: t.outcome,
          lastTrigger: t.trigger,
          lastAttempt: t.attempt,
          lastError: t.error,
        })
        .from(t)
        .where(scope)
        // Равное время (одна миллисекунда) — решает номер попытки: повтор новее.
        .orderBy(t.marketplace, t.periodKey, desc(t.finishedAt), desc(t.attempt)),
      executor
        .select({
          marketplace: t.marketplace,
          periodKey: t.periodKey,
          at: max(t.finishedAt),
        })
        .from(t)
        .where(and(scope, inArray(t.outcome, SUCCESS_OUTCOMES)))
        .groupBy(t.marketplace, t.periodKey),
    ]);
    const successAt = new Map(
      successes.map((row) => [`${row.marketplace}|${row.periodKey}`, row.at]),
    );
    return latest.map((row) => ({
      ...row,
      lastSuccessAt: successAt.get(`${row.marketplace}|${row.periodKey}`) ?? null,
    }));
  }

  /** Срок хранения: строки старше `before` удаляются. Сколько удалено. */
  async prune(before: Date, executor: TFinanceExecutor = this.db): Promise<number> {
    const removed = await executor
      .delete(t)
      .where(lt(t.finishedAt, before))
      .returning({ one: sql<number>`1` });
    return removed.length;
  }
}
