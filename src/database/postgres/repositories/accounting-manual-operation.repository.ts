import type {
  IManualOperationValue,
  TManualOperationAction,
} from '../../../modules/accounting/manual-operation.domain';
import type { IFinancePeriod } from '../../../modules/finance/finance-period';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';

import { changedFields, manualSnapshot } from '../../../modules/accounting/manual-operation.domain';
import { FINANCE_DB } from '../finance-db';
import { accountingManualOperationChanges, accountingManualOperations } from '../finance.schema';

export type TManualOperationRow = typeof accountingManualOperations.$inferSelect;
export type TManualOperationChangeRow = typeof accountingManualOperationChanges.$inferSelect;

/** Кто меняет: продавец из CRM и, если админ действует за него, — админ. */
export interface IManualOperationActor {
  author: string;
  impersonatedBy?: string | null;
}

const m = accountingManualOperations;
const c = accountingManualOperationChanges;

const valueOf = (row: TManualOperationRow): IManualOperationValue =>
  manualSnapshot({
    marketplace: row.marketplace,
    article: row.article,
    subArticle: row.subArticle ?? null,
    amountKopecks: row.amountKopecks,
    accruedOn: row.accruedOn,
    orderId: row.orderId ?? null,
    sku: row.sku ?? null,
    source: row.source,
    documentNumber: row.documentNumber ?? null,
    note: row.note ?? null,
  });

/**
 * Ручные операции «Финучёта» и их журнал изменений (TASK-208). Скоуп —
 * telegramUserId в каждом условии: чужая операция для продавца не существует.
 * Каждое изменение пишется в одной транзакции со строкой журнала — история не
 * может разойтись с операцией.
 */
@Injectable()
export class AccountingManualOperationRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  /** Живые операции продавца; период — по дню начисления, включительно. */
  list(
    telegramUserId: string,
    period: IFinancePeriod | null = null,
    executor: TFinanceExecutor = this.db,
  ): Promise<TManualOperationRow[]> {
    return executor
      .select()
      .from(m)
      .where(
        and(
          eq(m.telegramUserId, telegramUserId),
          isNull(m.deletedAt),
          ...(period ? [gte(m.accruedOn, period.from), lte(m.accruedOn, period.to)] : []),
        ),
      )
      .orderBy(desc(m.accruedOn), desc(m.createdAt));
  }

  /**
   * Создать по ключу формы. Повтор той же формы (тот же `clientKey`) — уже
   * созданная строка и `created: false`: дубля нет, второй записи журнала тоже.
   * Гонку двух отправок решает уникальный индекс.
   */
  async create(
    telegramUserId: string,
    clientKey: string,
    value: IManualOperationValue,
    actor: IManualOperationActor,
  ): Promise<{ row: TManualOperationRow; created: boolean }> {
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(m)
        .values({ telegramUserId, clientKey, ...value, author: actor.author })
        .onConflictDoNothing({ target: [m.telegramUserId, m.clientKey] })
        .returning();
      if (!inserted) {
        const [existing] = await tx
          .select()
          .from(m)
          .where(and(eq(m.telegramUserId, telegramUserId), eq(m.clientKey, clientKey)));
        return { row: existing, created: false };
      }
      await this.log(tx, inserted, 'create', null, valueOf(inserted), actor);
      return { row: inserted, created: true };
    });
  }

  /**
   * Правка живой операции. Нет такой (или удалена) — null. Ничего не
   * изменилось — строка как есть, без записи журнала: повтор формы правки не
   * плодит «изменена» без изменений.
   */
  async update(
    telegramUserId: string,
    id: string,
    value: IManualOperationValue,
    actor: IManualOperationActor,
  ): Promise<TManualOperationRow | null> {
    return this.db.transaction(async (tx) => {
      const current = await this.live(tx, telegramUserId, id);
      if (!current) return null;
      const before = valueOf(current);
      const after = manualSnapshot(value);
      if (!changedFields(before, after).length) return current;
      const [row] = await tx
        .update(m)
        .set({ ...after, updatedAt: new Date() })
        .where(and(eq(m.telegramUserId, telegramUserId), eq(m.id, id)))
        .returning();
      await this.log(tx, row, 'update', before, after, actor);
      return row;
    });
  }

  /**
   * Мягкое удаление: строка остаётся для истории, из списков и расчётов уходит.
   * `removed` — удалена сейчас, `gone` — уже была удалена (повтор), `null` — нет такой.
   */
  async remove(
    telegramUserId: string,
    id: string,
    actor: IManualOperationActor,
  ): Promise<'removed' | 'gone' | null> {
    return this.db.transaction(async (tx) => {
      const current = await this.live(tx, telegramUserId, id);
      if (!current) {
        const [any] = await tx
          .select({ id: m.id })
          .from(m)
          .where(and(eq(m.telegramUserId, telegramUserId), eq(m.id, id)));
        return any ? 'gone' : null;
      }
      const now = new Date();
      await tx
        .update(m)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(m.telegramUserId, telegramUserId), eq(m.id, id)));
      await this.log(tx, current, 'delete', valueOf(current), null, actor);
      return 'removed';
    });
  }

  /** Журнал изменений операции — от первой записи к последней; чужая — пусто. */
  history(
    telegramUserId: string,
    id: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TManualOperationChangeRow[]> {
    return executor
      .select()
      .from(c)
      .where(and(eq(c.telegramUserId, telegramUserId), eq(c.operationId, id)))
      .orderBy(asc(c.createdAt), asc(c.id));
  }

  private async live(
    executor: TFinanceExecutor,
    telegramUserId: string,
    id: string,
  ): Promise<TManualOperationRow | null> {
    const [row] = await executor
      .select()
      .from(m)
      .where(and(eq(m.telegramUserId, telegramUserId), eq(m.id, id), isNull(m.deletedAt)))
      .for('update');
    return row ?? null;
  }

  private async log(
    executor: TFinanceExecutor,
    row: TManualOperationRow,
    action: TManualOperationAction,
    before: IManualOperationValue | null,
    after: IManualOperationValue | null,
    actor: IManualOperationActor,
  ): Promise<void> {
    await executor.insert(c).values({
      operationId: row.id,
      telegramUserId: row.telegramUserId,
      action,
      before,
      after,
      author: actor.author,
      impersonatedBy: actor.impersonatedBy ?? null,
    });
  }
}
