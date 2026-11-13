import type { TAccountingCostMethod } from './accounting-lots.domain';

import { Injectable } from '@nestjs/common';

import { AccountingCostSettingsRepository } from '../../database/postgres/repositories/accounting-cost-settings.repository';
import { FEATURE, isFeatureEnabled } from '../telegram/bots/shared/features.domain';

import {
  ACCOUNTING_COST_METHOD_TITLE,
  DEFAULT_ACCOUNTING_COST_METHOD,
  isAccountingCostMethod,
} from './accounting-lots.domain';

/** Не тот режим — доставка отвечает 400 со своим кодом. */
export class CostMethodValidationError extends Error {
  constructor() {
    super('Выберите режим себестоимости из списка');
    this.name = 'CostMethodValidationError';
  }
}

export interface ICostSettingsSnapshot {
  method: TAccountingCostMethod;
  methodTitle: string;
  /** true — продавец не выбирал, действует умолчание (А). */
  isDefault: boolean;
  updatedAt: Date | null;
}

/**
 * Режим себестоимости продавца (TASK-215, решение `accounting_cost_mode_setting`):
 * А — закуп из прайса v2, Б — партии закупок FIFO. Нет строки — А.
 */
@Injectable()
export class AccountingCostSettingsService {
  constructor(private readonly repository: AccountingCostSettingsRepository) {}

  async snapshot(telegramUserId: string): Promise<ICostSettingsSnapshot> {
    const row = await this.repository.find(telegramUserId);
    // Значение из базы не того режима (ручная правка) — не угадываем, берём умолчание.
    if (!row || !isAccountingCostMethod(row.method)) {
      return {
        method: DEFAULT_ACCOUNTING_COST_METHOD,
        methodTitle: ACCOUNTING_COST_METHOD_TITLE[DEFAULT_ACCOUNTING_COST_METHOD],
        isDefault: true,
        updatedAt: null,
      };
    }
    return {
      method: row.method,
      methodTitle: ACCOUNTING_COST_METHOD_TITLE[row.method],
      isDefault: false,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Действующий режим: Б — только при открытой `fin_accounting_lots` (фича
   * закрыта — партий продавец не видит, и считать по ним нельзя), иначе А.
   */
  async methodOf(
    telegramUserId: string,
    features: Readonly<Record<string, boolean>>,
  ): Promise<TAccountingCostMethod> {
    const { method } = await this.snapshot(telegramUserId);
    return method === 'lot_fifo' && isFeatureEnabled({ ...features }, FEATURE.FIN_ACCOUNTING_LOTS)
      ? 'lot_fifo'
      : DEFAULT_ACCOUNTING_COST_METHOD;
  }

  async set(telegramUserId: string, method: unknown): Promise<ICostSettingsSnapshot> {
    if (!isAccountingCostMethod(method)) throw new CostMethodValidationError();
    const row = await this.repository.upsert(telegramUserId, method);
    return {
      method,
      methodTitle: ACCOUNTING_COST_METHOD_TITLE[method],
      isDefault: false,
      updatedAt: row.updatedAt,
    };
  }
}
