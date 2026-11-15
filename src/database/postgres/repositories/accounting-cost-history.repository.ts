import type {
  IAccountingCostRecord,
  IAccountingCostWrite,
  TAccountingCostChangeAction,
} from '../../../modules/accounting/accounting-cost-history.domain';
import type { IProductPurchase } from '../../../modules/products/product.domain';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import {
  correctionKind,
  costValueOf,
} from '../../../modules/accounting/accounting-cost-history.domain';
import { FINANCE_DB } from '../finance-db';
import { accountingCostRecordChanges, accountingCostRecords } from '../finance.schema';

export type TAccountingCostRow = typeof accountingCostRecords.$inferSelect;
export type TAccountingCostChangeRow = typeof accountingCostRecordChanges.$inferSelect;

/** Кто исправляет: продавец из CRM и, если админ действует за него, — админ. */
export interface IAccountingCostActor {
  author: string;
  impersonatedBy?: string | null;
}

/** Исправление, уже проверенное доменом. */
export interface IAccountingCostCorrection {
  validFrom: Date;
  purchase: IProductPurchase;
  reason: string;
}

export interface IAccountingCostCorrectionResult {
  action: TAccountingCostChangeAction | 'noop';
  record: TAccountingCostRow;
}

const r = accountingCostRecords;

/**
 * Строк/id в одном запросе. У протокола Postgres потолок 65 535 параметров
 * (счётчик Int16): 15.11.2026 прайс на 17 526 товаров дал одним INSERT 87 630
 * параметров, счётчик переполнился в «bind message has 22094 parameter formats
 * but 0 parameters» (08P01), и история закупа не записалась вовсе. 1000 строк ×
 * 5 параметров — с запасом, как UPSERT_CHUNK_SIZE журнала.
 */
export const COST_CHUNK_SIZE = 1000;
const c = accountingCostRecordChanges;

/** Строка таблицы → запись для правил домена. */
export function costRecordOf(row: TAccountingCostRow): IAccountingCostRecord {
  return {
    validFrom: row.validFrom,
    purchase: row.purchase,
    source: row.source,
    author: row.author,
  };
}

/**
 * История закупа v2 «Финучёта» и журнал её исправлений (TASK-213). Скоуп —
 * telegramUserId в каждом условии. Исправление и строка журнала пишутся в одной
 * транзакции; строки истории не удаляются никогда.
 */
@Injectable()
export class AccountingCostHistoryRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  /** Записи товаров продавца по возрастанию начала: id товара → строки. */
  async recordsFor(
    telegramUserId: string,
    productIds: readonly string[],
    executor: TFinanceExecutor = this.db,
  ): Promise<Map<string, TAccountingCostRow[]>> {
    const byProduct = new Map<string, TAccountingCostRow[]>();
    const ids = [...new Set(productIds)];
    if (!ids.length) return byProduct;
    const rows: TAccountingCostRow[] = [];
    for (let i = 0; i < ids.length; i += COST_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + COST_CHUNK_SIZE);
      rows.push(
        ...(await executor
          .select()
          .from(r)
          .where(and(eq(r.telegramUserId, telegramUserId), inArray(r.productId, chunk)))
          .orderBy(asc(r.validFrom))),
      );
    }
    // Товар целиком в одной пачке, поэтому порядок по validFrom внутри товара сохраняется.
    for (const row of rows) {
      const list = byProduct.get(row.productId) ?? [];
      list.push(row);
      byProduct.set(row.productId, list);
    }
    return byProduct;
  }

  /**
   * Загрузка прайса или перенос: добавить записи. Запись на тот же момент уже
   * есть — не трогается (повтор переноса безопасен, исправление не затирается).
   * Возвращает число добавленных.
   */
  async insertMany(
    telegramUserId: string,
    writes: readonly IAccountingCostWrite[],
  ): Promise<number> {
    // Без транзакции: onConflictDoNothing делает повтор безопасным, а недописанное
    // догонит следующая загрузка прайса.
    let count = 0;
    for (let i = 0; i < writes.length; i += COST_CHUNK_SIZE) {
      const inserted = await this.db
        .insert(r)
        .values(
          writes.slice(i, i + COST_CHUNK_SIZE).map((write) => ({
            telegramUserId,
            productId: write.productId,
            validFrom: write.validFrom,
            purchase: write.purchase,
            source: write.source,
          })),
        )
        .onConflictDoNothing({ target: [r.telegramUserId, r.productId, r.validFrom] })
        .returning({ id: r.id });
      count += inserted.length;
    }
    return count;
  }

  /**
   * Исправление прошлой цены. Запись ровно на этот момент есть — её закуп
   * переписывается (`source: 'manual'`, автор), было/стало — в журнал; нет —
   * заводится новая запись и строка журнала без «было»; совпадает — ничего.
   */
  async correct(
    telegramUserId: string,
    productId: string,
    correction: IAccountingCostCorrection,
    actor: IAccountingCostActor,
  ): Promise<IAccountingCostCorrectionResult> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(r)
        .where(
          and(
            eq(r.telegramUserId, telegramUserId),
            eq(r.productId, productId),
            eq(r.validFrom, correction.validFrom),
          ),
        )
        .for('update');

      const action = correctionKind(existing ? costRecordOf(existing) : null, correction.purchase);
      if (action === 'noop') return { action, record: existing };

      let record: TAccountingCostRow;
      if (action === 'correct') {
        [record] = await tx
          .update(r)
          .set({
            purchase: correction.purchase,
            source: 'manual',
            author: actor.author,
            updatedAt: new Date(),
          })
          .where(eq(r.id, existing.id))
          .returning();
      } else {
        [record] = await tx
          .insert(r)
          .values({
            telegramUserId,
            productId,
            validFrom: correction.validFrom,
            purchase: correction.purchase,
            source: 'manual',
            author: actor.author,
          })
          .returning();
      }

      await tx.insert(c).values({
        recordId: record.id,
        telegramUserId,
        productId,
        action,
        before: existing ? costValueOf(existing) : null,
        after: costValueOf(record),
        author: actor.author,
        impersonatedBy: actor.impersonatedBy ?? null,
        reason: correction.reason,
      });
      return { action, record };
    });
  }

  /** Журнал исправлений товара — от последнего к первому; чужой товар — пусто. */
  changes(telegramUserId: string, productId: string): Promise<TAccountingCostChangeRow[]> {
    return this.db
      .select()
      .from(c)
      .where(and(eq(c.telegramUserId, telegramUserId), eq(c.productId, productId)))
      .orderBy(desc(c.createdAt), desc(c.id));
  }
}
