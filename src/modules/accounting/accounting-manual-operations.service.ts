import type { TManualOperationField } from './manual-operation.domain';
import type {
  IManualOperationActor,
  TManualOperationChangeRow,
  TManualOperationRow,
} from '../../database/postgres/repositories/accounting-manual-operation.repository';
import type { IFinancePeriod } from '../finance/finance-period';

import { Injectable } from '@nestjs/common';

import { AccountingManualOperationRepository } from '../../database/postgres/repositories/accounting-manual-operation.repository';
import { isUuid } from '../finance/expense.domain';

import { isClientKey, validateManualOperationInput } from './manual-operation.domain';

/** Ввод не прошёл проверку — `field` говорит, под каким полем показать. */
export class ManualOperationValidationError extends Error {
  constructor(
    readonly field: TManualOperationField,
    message: string,
  ) {
    super(message);
    this.name = 'ManualOperationValidationError';
  }
}

/** Операции нет — или она чужая: для продавца это одно и то же. */
export class ManualOperationNotFoundError extends Error {
  constructor(message = 'Операция не найдена') {
    super(message);
    this.name = 'ManualOperationNotFoundError';
  }
}

/**
 * Ручные операции реестра «Финучёта» (ТЗ п.1, TASK-208) — единственная дверь к
 * ним. Своя таблица (решение `accounting_manual_ops_own_table`): текущий P&L и
 * все его читатели этих строк не видят, их читает только новый движок через
 * `liveFor`. Создание идемпотентно по ключу формы, правка и удаление — через
 * журнал изменений.
 */
@Injectable()
export class AccountingManualOperationsService {
  constructor(private readonly repository: AccountingManualOperationRepository) {}

  list(telegramUserId: string): Promise<TManualOperationRow[]> {
    return this.repository.list(telegramUserId);
  }

  /** Для расчётов нового движка: живые операции периода по дню начисления. */
  liveFor(telegramUserId: string, period: IFinancePeriod): Promise<TManualOperationRow[]> {
    return this.repository.list(telegramUserId, period);
  }

  async create(
    telegramUserId: string,
    input: Record<string, unknown>,
    actor: IManualOperationActor,
  ): Promise<{ row: TManualOperationRow; created: boolean }> {
    if (!isClientKey(input.clientKey)) {
      throw new ManualOperationValidationError('clientKey', 'Форма устарела — откройте её заново');
    }
    return this.repository.create(telegramUserId, input.clientKey, this.validated(input), actor);
  }

  async update(
    telegramUserId: string,
    id: string,
    input: Record<string, unknown>,
    actor: IManualOperationActor,
  ): Promise<TManualOperationRow> {
    if (!isUuid(id)) throw new ManualOperationNotFoundError();
    const row = await this.repository.update(telegramUserId, id, this.validated(input), actor);
    if (!row) throw new ManualOperationNotFoundError();
    return row;
  }

  /** Удаление; повтор по уже удалённой — не ошибка (форма могла отправиться дважды). */
  async remove(telegramUserId: string, id: string, actor: IManualOperationActor): Promise<void> {
    if (!isUuid(id)) throw new ManualOperationNotFoundError();
    const result = await this.repository.remove(telegramUserId, id, actor);
    if (!result) throw new ManualOperationNotFoundError();
  }

  async history(telegramUserId: string, id: string): Promise<TManualOperationChangeRow[]> {
    if (!isUuid(id)) throw new ManualOperationNotFoundError();
    const rows = await this.repository.history(telegramUserId, id);
    if (!rows.length) throw new ManualOperationNotFoundError();
    return rows;
  }

  private validated(input: Record<string, unknown>) {
    const checked = validateManualOperationInput(input);
    if (checked.ok === false)
      throw new ManualOperationValidationError(checked.field, checked.error);
    return checked.value;
  }
}
