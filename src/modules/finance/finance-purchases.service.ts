import type { TPurchaseField } from './purchase.domain';
import type {
  TFinancePurchaseRow,
  TFinanceTaxPaymentRow,
} from '../../database/postgres/repositories/finance-purchase.repository';

import { Injectable } from '@nestjs/common';

import { FinancePurchaseRepository } from '../../database/postgres/repositories/finance-purchase.repository';

import { isUuid } from './expense.domain';
import { validatePurchaseInput, validateTaxPaymentInput } from './purchase.domain';

/** Ввод закупки или уплаты налога не прошёл проверку — `field` говорит, под каким полем. */
export class PurchaseValidationError extends Error {
  constructor(
    readonly field: TPurchaseField | 'period',
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseValidationError';
  }
}

/** Записи нет — или она чужая: для продавца это одно и то же. */
export class PurchaseNotFoundError extends Error {
  constructor(message = 'Запись не найдена') {
    super(message);
    this.name = 'PurchaseNotFoundError';
  }
}

export interface IPurchasesSnapshot {
  purchases: TFinancePurchaseRow[];
  taxPayments: TFinanceTaxPaymentRow[];
}

/**
 * Закупки партий и уплаченные налоги (TASK-122). Единственная дверь к ним:
 * CRM правит записи через неё, ДДС (`FinanceCashflowService`) читает через
 * неё же. В P&L ничего отсюда не идёт — закупка не расход прибыли.
 */
@Injectable()
export class FinancePurchasesService {
  constructor(private readonly repository: FinancePurchaseRepository) {}

  async snapshot(telegramUserId: string): Promise<IPurchasesSnapshot> {
    const [purchases, taxPayments] = await Promise.all([
      this.repository.listPurchases(telegramUserId),
      this.repository.listTaxPayments(telegramUserId),
    ]);
    return { purchases, taxPayments };
  }

  /** Закупки и уплаты налога, оплаченные в дни `fromDay…toDay` включительно. */
  async between(
    telegramUserId: string,
    fromDay: string,
    toDay: string,
  ): Promise<IPurchasesSnapshot> {
    const [purchases, taxPayments] = await Promise.all([
      this.repository.purchasesBetween(telegramUserId, fromDay, toDay),
      this.repository.taxPaymentsBetween(telegramUserId, fromDay, toDay),
    ]);
    return { purchases, taxPayments };
  }

  async createPurchase(
    telegramUserId: string,
    input: Record<string, unknown>,
  ): Promise<TFinancePurchaseRow> {
    return this.repository.createPurchase(telegramUserId, purchaseValue(input));
  }

  async updatePurchase(
    telegramUserId: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<TFinancePurchaseRow> {
    if (!isUuid(id)) throw new PurchaseNotFoundError();
    const row = await this.repository.updatePurchase(telegramUserId, id, purchaseValue(input));
    if (!row) throw new PurchaseNotFoundError();
    return row;
  }

  async removePurchase(telegramUserId: string, id: string): Promise<void> {
    if (!isUuid(id) || !(await this.repository.removePurchase(telegramUserId, id))) {
      throw new PurchaseNotFoundError();
    }
  }

  async createTaxPayment(
    telegramUserId: string,
    input: Record<string, unknown>,
  ): Promise<TFinanceTaxPaymentRow> {
    return this.repository.createTaxPayment(telegramUserId, taxPaymentValue(input));
  }

  async updateTaxPayment(
    telegramUserId: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<TFinanceTaxPaymentRow> {
    if (!isUuid(id)) throw new PurchaseNotFoundError();
    const row = await this.repository.updateTaxPayment(telegramUserId, id, taxPaymentValue(input));
    if (!row) throw new PurchaseNotFoundError();
    return row;
  }

  async removeTaxPayment(telegramUserId: string, id: string): Promise<void> {
    if (!isUuid(id) || !(await this.repository.removeTaxPayment(telegramUserId, id))) {
      throw new PurchaseNotFoundError();
    }
  }
}

function purchaseValue(input: Record<string, unknown>) {
  const checked = validatePurchaseInput(input);
  if (checked.ok === false) throw new PurchaseValidationError(checked.field, checked.error);
  return checked.value;
}

function taxPaymentValue(input: Record<string, unknown>) {
  const checked = validateTaxPaymentInput(input);
  if (checked.ok === false) throw new PurchaseValidationError(checked.field, checked.error);
  return checked.value;
}
