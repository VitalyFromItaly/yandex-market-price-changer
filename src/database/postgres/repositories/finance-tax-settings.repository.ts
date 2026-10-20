import type { ITaxSettings } from '../../../modules/finance/tax.domain';
import type { TFinanceDb, TFinanceExecutor } from '../finance-db';

import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { FINANCE_DB } from '../finance-db';
import { financeTaxSettings } from '../finance.schema';

export type TFinanceTaxSettingsRow = typeof financeTaxSettings.$inferSelect;

const t = financeTaxSettings;

/**
 * Налоговые настройки продавца (TASK-123): одна строка на `telegramUserId`.
 * Нет строки — `null`, умолчание подставляет сервис: хранятся только явные
 * решения продавца (правило `UserAccess.features`).
 */
@Injectable()
export class FinanceTaxSettingsRepository {
  constructor(@Inject(FINANCE_DB) private readonly db: TFinanceDb) {}

  async find(
    telegramUserId: string,
    executor: TFinanceExecutor = this.db,
  ): Promise<TFinanceTaxSettingsRow | null> {
    const [row] = await executor.select().from(t).where(eq(t.telegramUserId, telegramUserId));
    return row ?? null;
  }

  /**
   * `hasStaff` не передан — колонка не трогается: форма режима и ставки
   * (TASK-123) о работниках не знает и не должна сбрасывать их флаг.
   */
  async upsert(
    telegramUserId: string,
    value: ITaxSettings,
    executor: TFinanceExecutor = this.db,
    hasStaff?: boolean,
  ): Promise<TFinanceTaxSettingsRow> {
    const fields = hasStaff === undefined ? { ...value } : { ...value, hasStaff };
    const [row] = await executor
      .insert(t)
      .values({ telegramUserId, ...fields })
      .onConflictDoUpdate({ target: t.telegramUserId, set: { ...fields, updatedAt: new Date() } })
      .returning();
    return row;
  }
}
