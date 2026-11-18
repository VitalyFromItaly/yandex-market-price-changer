import type {
  IOrderProfit,
  TOrderResultSnapshotReason,
} from '../../../modules/accounting/order-profit-state';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';
import type { TFinanceMarketplace } from '../finance.schema';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

import {
  orderProfitFingerprint,
  snapshotReasonOf,
} from '../../../modules/accounting/order-profit-state';
import { FINANCE_DB } from '../finance-db';
import { accountingOrderResults, accountingOrderResultVersions } from '../finance.schema';

export type TAccountingOrderResultRow = typeof accountingOrderResults.$inferSelect;
export type TAccountingOrderResultVersionRow = typeof accountingOrderResultVersions.$inferSelect;

export interface IOrderResultSnapshotKey {
  marketplace: TFinanceMarketplace;
  orderId: string;
}

export interface IOrderResultSnapshotWrite {
  /** Текущая версия после вызова. */
  version: number;
  /** false — отпечаток совпал, версия не писалась. */
  written: boolean;
  /** Причина записанной версии; null — не писалась. */
  reason: TOrderResultSnapshotReason | null;
}

const r = accountingOrderResults;
const v = accountingOrderResultVersions;

/**
 * Версионные снимки результата заказа «Финучёта» (TASK-218). Версия пишется только
 * при смене отпечатка (`orderProfitFingerprint`) и всегда с причиной
 * (`snapshotReasonOf`); прежние версии не переписываются никогда — поздняя
 * корректировка после сверки видна новой строкой рядом со сверенной.
 * Голова читается под `FOR UPDATE` в транзакции, как у `AccountingOrderLineRepository`:
 * два пересчёта одного заказа не запишут одну версию дважды (уникальный
 * `(result_id, version)` уронил бы второй, а не испортил историю). Первая вставка
 * головы — `ON CONFLICT DO NOTHING` с перечитыванием: отсутствующую строку `FOR UPDATE`
 * не блокирует, и параллельные CRM-джобы (дашборд + заказы) падали на 23505.
 */
@Injectable()
export class AccountingOrderResultRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  async recordSnapshot(
    telegramUserId: string,
    key: IOrderResultSnapshotKey,
    profit: IOrderProfit,
    now: Date = new Date(),
  ): Promise<IOrderResultSnapshotWrite> {
    const fingerprint = orderProfitFingerprint(profit);
    const head = {
      state: profit.state,
      netKopecks: profit.netKopecks,
      confirmedKopecks: profit.confirmedKopecks,
      expectedKopecks: profit.expectedKopecks,
    };
    return await this.db.transaction(async (tx) => {
      const headOf = async (): Promise<TAccountingOrderResultRow | undefined> => {
        const [found] = await tx
          .select()
          .from(r)
          .where(
            and(
              eq(r.telegramUserId, telegramUserId),
              eq(r.marketplace, key.marketplace),
              eq(r.orderId, key.orderId),
            ),
          )
          .for('update');
        return found;
      };

      let row = await headOf();
      let resultId: string | null = null;
      if (!row) {
        // FOR UPDATE не блокирует отсутствующую строку: параллельный пересчёт того же заказа
        // тоже видит «нет головы». ON CONFLICT ждёт чужую транзакцию — проигравший перечитывает
        // уже закоммиченную голову и идёт по ветке существующей строки.
        const [inserted] = await tx
          .insert(r)
          .values({
            ...head,
            marketplace: key.marketplace,
            telegramUserId,
            orderId: key.orderId,
            version: 1,
            fingerprint,
            changedAt: now,
          })
          .onConflictDoNothing({ target: [r.marketplace, r.telegramUserId, r.orderId] })
          .returning({ id: r.id });
        if (inserted) resultId = inserted.id;
        else row = await headOf();
      }

      if (row && row.fingerprint === fingerprint) {
        return { version: row.version, written: false, reason: null };
      }

      const reason = snapshotReasonOf(row ? row.state : null, profit.state);
      let version = 1;
      if (row) {
        version = row.version + 1;
        resultId = row.id;
        await tx
          .update(r)
          .set({ ...head, version, fingerprint, changedAt: now })
          .where(eq(r.id, row.id));
      }
      await tx.insert(v).values({
        resultId,
        telegramUserId,
        version,
        state: profit.state,
        value: profit,
        fingerprint,
        reason,
        capturedAt: now,
      });
      return { version, written: true, reason };
    });
  }

  /** Текущий снимок заказа продавца. */
  async currentOf(
    telegramUserId: string,
    key: IOrderResultSnapshotKey,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingOrderResultRow | null> {
    const [row] = await executor
      .select()
      .from(r)
      .where(
        and(
          eq(r.telegramUserId, telegramUserId),
          eq(r.marketplace, key.marketplace),
          eq(r.orderId, key.orderId),
        ),
      );
    return row ?? null;
  }

  /** История версий заказа по порядку. */
  async versionsOf(
    telegramUserId: string,
    key: IOrderResultSnapshotKey,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingOrderResultVersionRow[]> {
    const head = await this.currentOf(telegramUserId, key, executor);
    if (!head) return [];
    return await executor
      .select()
      .from(v)
      .where(and(eq(v.telegramUserId, telegramUserId), eq(v.resultId, head.id)))
      .orderBy(asc(v.version));
  }
}
