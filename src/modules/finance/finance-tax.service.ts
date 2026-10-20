import type { ITaxSettings, TTaxField } from './tax.domain';
import type { TFinanceTaxSettingsRow } from '../../database/postgres/repositories/finance-tax-settings.repository';

import { Injectable } from '@nestjs/common';

import { FinanceTaxSettingsRepository } from '../../database/postgres/repositories/finance-tax-settings.repository';

import {
  DEFAULT_TAX_SETTINGS,
  isTaxRecognition,
  isTaxRegime,
  validateTaxSettingsInput,
} from './tax.domain';

/** Ввод налоговых настроек не прошёл проверку — `field` говорит, под каким полем показать. */
export class TaxSettingsValidationError extends Error {
  constructor(
    readonly field: TTaxField,
    message: string,
  ) {
    super(message);
    this.name = 'TaxSettingsValidationError';
  }
}

export interface ITaxSettingsSnapshot {
  settings: ITaxSettings;
  /** Строки в базе нет — действует умолчание, продавец его ещё не подтвердил. */
  isDefault: boolean;
  updatedAt: Date | null;
  /** Есть работники (TASK-146) — лимит уменьшения налога на взносы. */
  hasStaff: boolean;
}

/**
 * Строка базы → настройки. Мусор в строке (правка руками, будущая миграция)
 * не роняет расчёт, а откатывает поле к умолчанию — тот же довод, что у
 * `promoConfigsOf`: битая запись не должна ломать отчёт.
 */
function settingsOf(row: TFinanceTaxSettingsRow): ITaxSettings {
  return {
    regime: isTaxRegime(row.regime) ? row.regime : DEFAULT_TAX_SETTINGS.regime,
    rateBasisPoints: Number.isInteger(row.rateBasisPoints)
      ? row.rateBasisPoints
      : DEFAULT_TAX_SETTINGS.rateBasisPoints,
    recognition: isTaxRecognition(row.recognition)
      ? row.recognition
      : DEFAULT_TAX_SETTINGS.recognition,
  };
}

function snapshotOf(row: TFinanceTaxSettingsRow): ITaxSettingsSnapshot {
  return {
    settings: settingsOf(row),
    isDefault: false,
    updatedAt: row.updatedAt,
    hasStaff: row.hasStaff === true,
  };
}

/**
 * Налоговые настройки продавца (TASK-123). Единственная дверь к ним: CRM
 * правит, движок P&L (TASK-120) читает `snapshot(...).settings` и зовёт `taxOf`.
 */
@Injectable()
export class FinanceTaxService {
  constructor(private readonly repository: FinanceTaxSettingsRepository) {}

  async snapshot(telegramUserId: string): Promise<ITaxSettingsSnapshot> {
    const row = await this.repository.find(telegramUserId);
    if (!row) {
      return {
        settings: { ...DEFAULT_TAX_SETTINGS },
        isDefault: true,
        updatedAt: null,
        hasStaff: false,
      };
    }
    return snapshotOf(row);
  }

  async update(
    telegramUserId: string,
    input: Record<string, unknown>,
  ): Promise<ITaxSettingsSnapshot> {
    const { settings: current } = await this.snapshot(telegramUserId);
    const checked = validateTaxSettingsInput(input, current);
    if (checked.ok === false) throw new TaxSettingsValidationError(checked.field, checked.error);
    const row = await this.repository.upsert(telegramUserId, checked.value);
    return snapshotOf(row);
  }

  /**
   * Флаг «есть работники» (TASK-146, вкладка «Год»). Строки ещё нет — она
   * заводится с действующими настройками: продавец ими уже пользуется, и
   * отметка работников не должна менять режим.
   */
  async setStaff(telegramUserId: string, hasStaff: unknown): Promise<ITaxSettingsSnapshot> {
    if (typeof hasStaff !== 'boolean') {
      throw new TaxSettingsValidationError('staff', 'Работники — да или нет');
    }
    const { settings } = await this.snapshot(telegramUserId);
    const row = await this.repository.upsert(telegramUserId, settings, undefined, hasStaff);
    return snapshotOf(row);
  }
}
