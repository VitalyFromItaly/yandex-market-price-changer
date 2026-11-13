import type { TTaxBaseRule } from './accounting-tax';

import { Injectable } from '@nestjs/common';

import { AccountingTaxSettingsRepository } from '../../database/postgres/repositories/accounting-tax-settings.repository';

import {
  DEFAULT_TAX_BASE_RULE,
  TAX_BASE_RULE_HINT,
  TAX_BASE_RULE_TITLE,
  isTaxBaseRule,
} from './accounting-tax';

/** Не то правило базы — доставка отвечает 400 со своим кодом. */
export class TaxBaseRuleValidationError extends Error {
  constructor() {
    super('Выберите правило налоговой базы из списка');
    this.name = 'TaxBaseRuleValidationError';
  }
}

export interface ITaxBaseRuleSnapshot {
  rule: TTaxBaseRule;
  ruleTitle: string;
  ruleHint: string;
  /** true — продавец не выбирал, действует умолчание. */
  isDefault: boolean;
  updatedAt: Date | null;
}

const snapshotOf = (
  rule: TTaxBaseRule,
  isDefault: boolean,
  updatedAt: Date | null,
): ITaxBaseRuleSnapshot => ({
  rule,
  ruleTitle: TAX_BASE_RULE_TITLE[rule],
  ruleHint: TAX_BASE_RULE_HINT[rule],
  isDefault,
  updatedAt,
});

/**
 * Правило агентской базы налога «Финучёта» (TASK-221, решение
 * `accounting_tax_base_gross`). Нет строки — валовая.
 */
@Injectable()
export class AccountingTaxSettingsService {
  constructor(private readonly repository: AccountingTaxSettingsRepository) {}

  async snapshot(telegramUserId: string): Promise<ITaxBaseRuleSnapshot> {
    const row = await this.repository.find(telegramUserId);
    // Значение из базы не того правила (ручная правка) — не угадываем, берём умолчание.
    if (!row || !isTaxBaseRule(row.baseRule)) return snapshotOf(DEFAULT_TAX_BASE_RULE, true, null);
    return snapshotOf(row.baseRule, false, row.updatedAt);
  }

  async set(telegramUserId: string, rule: unknown): Promise<ITaxBaseRuleSnapshot> {
    if (!isTaxBaseRule(rule)) throw new TaxBaseRuleValidationError();
    const row = await this.repository.upsert(telegramUserId, rule);
    return snapshotOf(rule, false, row.updatedAt);
  }
}
