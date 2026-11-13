import type { TAccountingCostMethod } from '../../../modules/accounting/accounting-lots.domain';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { accountingCostSettings } from '../finance.schema';

export type TAccountingCostSettingsRow = typeof accountingCostSettings.$inferSelect;

const t = accountingCostSettings;

/**
 * Режим себестоимости продавца (TASK-215): одна строка на `telegramUserId`.
 * Нет строки — `null`, умолчание подставляет сервис.
 */
@Injectable()
export class AccountingCostSettingsRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  async find(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingCostSettingsRow | null> {
    const [row] = await executor.select().from(t).where(eq(t.telegramUserId, telegramUserId));
    return row ?? null;
  }

  async upsert(
    telegramUserId: string,
    method: TAccountingCostMethod,
    executor: TFinanceExecutor = this.db,
  ): Promise<TAccountingCostSettingsRow> {
    const [row] = await executor
      .insert(t)
      .values({ telegramUserId, method })
      .onConflictDoUpdate({ target: t.telegramUserId, set: { method, updatedAt: new Date() } })
      .returning();
    return row;
  }
}
