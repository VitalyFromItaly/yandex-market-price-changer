import type { TAllocationMethod } from '../../../modules/accounting/store-cost-allocation';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { accountingAllocationSettings } from '../finance.schema';

export type TAccountingAllocationSettingsRow = typeof accountingAllocationSettings.$inferSelect;

const t = accountingAllocationSettings;

/**
 * Методика распределения общих расходов (TASK-219): одна строка на `telegramUserId`.
 * Нет строки — `null`, умолчание подставляет сервис (как `FinanceTaxSettingsRepository`).
 */
@Injectable()
export class AccountingAllocationSettingsRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  async find(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingAllocationSettingsRow | null> {
    const [row] = await executor.select().from(t).where(eq(t.telegramUserId, telegramUserId));
    return row ?? null;
  }

  async upsert(
    telegramUserId: string,
    method: TAllocationMethod,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingAllocationSettingsRow> {
    const [row] = await executor
      .insert(t)
      .values({ telegramUserId, method })
      .onConflictDoUpdate({ target: t.telegramUserId, set: { method, updatedAt: new Date() } })
      .returning();
    return row;
  }
}
