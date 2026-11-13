import type { TTaxBaseRule } from '../../../modules/accounting/accounting-tax';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { accountingTaxSettings } from '../finance.schema';

export type TAccountingTaxSettingsRow = typeof accountingTaxSettings.$inferSelect;

const t = accountingTaxSettings;

/**
 * Правило агентской базы налога «Финучёта» (TASK-221): одна строка на `telegramUserId`.
 * Нет строки — `null`, умолчание подставляет сервис (как `AccountingAllocationSettingsRepository`).
 */
@Injectable()
export class AccountingTaxSettingsRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  async find(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingTaxSettingsRow | null> {
    const [row] = await executor.select().from(t).where(eq(t.telegramUserId, telegramUserId));
    return row ?? null;
  }

  async upsert(
    telegramUserId: string,
    baseRule: TTaxBaseRule,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingTaxSettingsRow> {
    const [row] = await executor
      .insert(t)
      .values({ telegramUserId, baseRule })
      .onConflictDoUpdate({ target: t.telegramUserId, set: { baseRule, updatedAt: new Date() } })
      .returning();
    return row;
  }
}
