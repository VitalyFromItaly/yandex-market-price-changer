import type {
  IAccountingOrderLineInput,
  IAccountingOrderLineValue,
  TAccountingOrdersSyncOutcome,
} from '../../../modules/accounting/accounting-order-lines.domain';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';
import type { TFinanceMarketplace } from '../finance.schema';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import {
  lineFingerprint,
  lineValueOf,
} from '../../../modules/accounting/accounting-order-lines.domain';
import { FINANCE_DB } from '../finance-db';
import {
  accountingOrderLines,
  accountingOrderLineVersions,
  accountingOrderSyncState,
} from '../finance.schema';

export type TAccountingOrderLineRow = typeof accountingOrderLines.$inferSelect;
export type TAccountingOrderLineVersionRow = typeof accountingOrderLineVersions.$inferSelect;
export type TAccountingOrderSyncStateRow = typeof accountingOrderSyncState.$inferSelect;

export interface IOrderLinesUpsertResult {
  /** Сколько строк пришло. */
  seen: number;
  /** Новые позиции (версия 1). */
  created: number;
  /** Позиции, у которых изменились значимые поля (версия +1). */
  changed: number;
}

const l = accountingOrderLines;
const v = accountingOrderLineVersions;
const s = accountingOrderSyncState;

/**
 * Снимок строк заказов «Финучёта» (TASK-210). Версия пишется только при смене
 * отпечатка значимых полей; опрос без изменений трогает лишь `last_seen_at`.
 * Строки одного вызова — в одной транзакции и под `FOR UPDATE`: два опроса
 * одного продавца не запишут одну версию дважды (уникальный `(line_id, version)`
 * уронил бы второй, а не испортил историю).
 */
@Injectable()
export class AccountingOrderLineRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  async upsertLines(
    telegramUserId: string,
    lines: readonly IAccountingOrderLineInput[],
    now: Date = new Date(),
  ): Promise<IOrderLinesUpsertResult> {
    const result: IOrderLinesUpsertResult = { seen: lines.length, created: 0, changed: 0 };
    if (!lines.length) return result;

    // Одна позиция дважды в пачке (две страницы с нахлёстом) — берём последнюю.
    const unique = new Map<string, IAccountingOrderLineInput>();
    for (const line of lines) unique.set(keyOf(line.marketplace, line.orderId, line.itemId), line);

    const marketplaces = [...new Set([...unique.values()].map((line) => line.marketplace))];
    await this.db.transaction(async (tx) => {
      const orderIds = [...new Set([...unique.values()].map((line) => line.orderId))];
      const existing = await tx
        .select()
        .from(l)
        .where(
          and(
            eq(l.telegramUserId, telegramUserId),
            inArray(l.marketplace, marketplaces),
            inArray(l.orderId, orderIds),
          ),
        )
        .for('update');
      const byKey = new Map(
        existing.map((row) => [keyOf(row.marketplace, row.orderId, row.itemId), row]),
      );

      const fresh: string[] = [];
      for (const [key, line] of unique) {
        const value = lineValueOf(line);
        const fingerprint = lineFingerprint(value);
        const row = byKey.get(key);
        if (!row) {
          const [inserted] = await tx
            .insert(l)
            .values({
              ...value,
              marketplace: line.marketplace,
              telegramUserId,
              orderId: line.orderId,
              itemId: line.itemId,
              version: 1,
              fingerprint,
              firstSeenAt: now,
              lastSeenAt: now,
              changedAt: now,
            })
            .returning({ id: l.id });
          await tx.insert(v).values({
            lineId: inserted.id,
            telegramUserId,
            version: 1,
            value,
            fingerprint,
            capturedAt: now,
          });
          result.created += 1;
          continue;
        }
        if (row.fingerprint === fingerprint) {
          fresh.push(row.id);
          continue;
        }
        const version = row.version + 1;
        await tx
          .update(l)
          .set({ ...value, version, fingerprint, lastSeenAt: now, changedAt: now })
          .where(eq(l.id, row.id));
        await tx.insert(v).values({
          lineId: row.id,
          telegramUserId,
          version,
          value,
          fingerprint,
          capturedAt: now,
        });
        result.changed += 1;
      }
      if (fresh.length) {
        await tx.update(l).set({ lastSeenAt: now }).where(inArray(l.id, fresh));
      }
    });
    return result;
  }

  /**
   * Текущие значимые поля строк по номерам заказов одной площадки — ключ
   * `заказ|позиция`. Нужны WB (TASK-211): продажа, пришедшая без заказа в окне,
   * ложится поверх сохранённой строки, а не стирает её цены.
   */
  async currentValues(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    orderIds: readonly string[],
    executor: TFinanceExecutor = this.db,
  ): Promise<Map<string, IAccountingOrderLineValue>> {
    const result = new Map<string, IAccountingOrderLineValue>();
    if (!orderIds.length) return result;
    const rows = await executor
      .select()
      .from(l)
      .where(
        and(
          eq(l.telegramUserId, telegramUserId),
          eq(l.marketplace, marketplace),
          inArray(l.orderId, [...new Set(orderIds)]),
        ),
      );
    for (const row of rows) result.set(`${row.orderId}|${row.itemId}`, lineValueOf(row));
    return result;
  }

  /** Позиции заказа продавца (будущая карточка заказа TASK-222/223). */
  async linesOf(
    telegramUserId: string,
    orderId: string,
    marketplace: TFinanceMarketplace = 'ym',
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingOrderLineRow[]> {
    return await executor
      .select()
      .from(l)
      .where(
        and(
          eq(l.telegramUserId, telegramUserId),
          eq(l.marketplace, marketplace),
          eq(l.orderId, orderId),
        ),
      )
      .orderBy(asc(l.itemId));
  }

  /**
   * Позиции заказов площадки по номерам (панель «Финучёта», TASK-229): месяц
   * оформления заказа, чья продажа начислена в периоде, и товары заказа для
   * фильтров. Пачками по 1000 — как `liveByOrderIds`.
   */
  async linesOfOrders(
    telegramUserId: string,
    orderIds: readonly string[],
    marketplace: TFinanceMarketplace,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingOrderLineRow[]> {
    const unique = [...new Set(orderIds)];
    const result: TAccountingOrderLineRow[] = [];
    for (let i = 0; i < unique.length; i += 1000) {
      const rows = await executor
        .select()
        .from(l)
        .where(
          and(
            eq(l.telegramUserId, telegramUserId),
            eq(l.marketplace, marketplace),
            inArray(l.orderId, unique.slice(i, i + 1000)),
          ),
        )
        .orderBy(asc(l.orderId), asc(l.itemId));
      result.push(...rows);
    }
    return result;
  }

  /**
   * Позиции, оформленные в дни `[fromDay, toDay]` (ГГГГ-ММ-ДД, включительно), —
   * заказы месяца карточки «Финучёта» и база распределения (TASK-222). Идёт по
   * индексу `(telegram_user_id, created_on)`; площадки — фильтром.
   */
  async linesCreatedBetween(
    telegramUserId: string,
    fromDay: string,
    toDay: string,
    marketplaces: readonly TFinanceMarketplace[],
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingOrderLineRow[]> {
    if (!marketplaces.length) return [];
    return await executor
      .select()
      .from(l)
      .where(
        and(
          eq(l.telegramUserId, telegramUserId),
          gte(l.createdOn, fromDay),
          lte(l.createdOn, toDay),
          inArray(l.marketplace, [...marketplaces]),
        ),
      )
      .orderBy(asc(l.createdOn), asc(l.orderId), asc(l.itemId));
  }

  /**
   * Все позиции продавца по всем площадкам — вход FIFO режима Б (TASK-215):
   * списание считается с нуля по всей истории, поэтому окна нет. Порядок
   * детерминирован; FIFO всё равно упорядочивает продажи сам.
   */
  async allForUser(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingOrderLineRow[]> {
    return await executor
      .select()
      .from(l)
      .where(eq(l.telegramUserId, telegramUserId))
      .orderBy(asc(l.createdOn), asc(l.marketplace), asc(l.orderId), asc(l.itemId));
  }

  /** Версии позиции по порядку. */
  async versionsOf(
    telegramUserId: string,
    lineId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingOrderLineVersionRow[]> {
    return await executor
      .select()
      .from(v)
      .where(and(eq(v.telegramUserId, telegramUserId), eq(v.lineId, lineId)))
      .orderBy(asc(v.version));
  }

  async syncState(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingOrderSyncStateRow | null> {
    const [row] = await executor
      .select()
      .from(s)
      .where(and(eq(s.telegramUserId, telegramUserId), eq(s.marketplace, marketplace)));
    return row ?? null;
  }

  /** Успех: последняя попытка, последний успех и верх его окна. */
  async recordSuccess(input: {
    telegramUserId: string;
    marketplace: TFinanceMarketplace;
    outcome: Exclude<TAccountingOrdersSyncOutcome, 'failed'>;
    at: Date;
    cursorAt: Date | null;
    linesSeen: number;
    versionsWritten: number;
  }): Promise<void> {
    const values = {
      lastAttemptAt: input.at,
      lastOutcome: input.outcome,
      lastError: null,
      lastSuccessAt: input.at,
      linesSeen: input.linesSeen,
      versionsWritten: input.versionsWritten,
      // «Не настроен» не двигает курсор: подключат магазин — первый опрос возьмёт 7 дней.
      ...(input.cursorAt ? { cursorAt: input.cursorAt } : {}),
    };
    await this.db
      .insert(s)
      .values({ telegramUserId: input.telegramUserId, marketplace: input.marketplace, ...values })
      .onConflictDoUpdate({ target: [s.telegramUserId, s.marketplace], set: values });
  }

  /** Сбой: последний успех и курсор остаются прежними. */
  async recordFailure(input: {
    telegramUserId: string;
    marketplace: TFinanceMarketplace;
    at: Date;
    error: string;
  }): Promise<void> {
    const values = {
      lastAttemptAt: input.at,
      lastOutcome: 'failed' as const,
      lastError: input.error.slice(0, 1000),
    };
    await this.db
      .insert(s)
      .values({ telegramUserId: input.telegramUserId, marketplace: input.marketplace, ...values })
      .onConflictDoUpdate({ target: [s.telegramUserId, s.marketplace], set: values });
  }
}

function keyOf(marketplace: string, orderId: string, itemId: string): string {
  return `${marketplace}|${orderId}|${itemId}`;
}
