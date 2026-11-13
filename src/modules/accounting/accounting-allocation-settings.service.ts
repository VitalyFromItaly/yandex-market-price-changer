import type { TAllocationMethod } from './store-cost-allocation';

import { BadRequestException, Injectable } from '@nestjs/common';

import { AccountingAllocationSettingsRepository } from '../../database/postgres/repositories/accounting-allocation-settings.repository';

import {
  ALLOCATION_METHOD_TITLE,
  DEFAULT_ALLOCATION_METHOD,
  isAllocationMethod,
} from './store-cost-allocation';

export interface IAllocationSettingsSnapshot {
  method: TAllocationMethod;
  methodTitle: string;
  /** true — продавец не выбирал, действует умолчание. */
  isDefault: boolean;
  updatedAt: Date | null;
}

/**
 * Методика распределения общих расходов продавца (TASK-219, решение
 * `accounting_allocation_method`). Нет строки — по выручке.
 */
@Injectable()
export class AccountingAllocationSettingsService {
  constructor(private readonly repository: AccountingAllocationSettingsRepository) {}

  async snapshot(telegramUserId: string): Promise<IAllocationSettingsSnapshot> {
    const row = await this.repository.find(telegramUserId);
    // Значение из базы не той методики (ручная правка) — не угадываем, берём умолчание.
    if (!row || !isAllocationMethod(row.method)) {
      return {
        method: DEFAULT_ALLOCATION_METHOD,
        methodTitle: ALLOCATION_METHOD_TITLE[DEFAULT_ALLOCATION_METHOD],
        isDefault: true,
        updatedAt: null,
      };
    }
    return {
      method: row.method,
      methodTitle: ALLOCATION_METHOD_TITLE[row.method],
      isDefault: false,
      updatedAt: row.updatedAt,
    };
  }

  async methodOf(telegramUserId: string): Promise<TAllocationMethod> {
    return (await this.snapshot(telegramUserId)).method;
  }

  async set(telegramUserId: string, method: unknown): Promise<IAllocationSettingsSnapshot> {
    if (!isAllocationMethod(method))
      throw new BadRequestException('Выберите методику распределения из списка');
    const row = await this.repository.upsert(telegramUserId, method);
    return {
      method,
      methodTitle: ALLOCATION_METHOD_TITLE[method],
      isDefault: false,
      updatedAt: row.updatedAt,
    };
  }
}
