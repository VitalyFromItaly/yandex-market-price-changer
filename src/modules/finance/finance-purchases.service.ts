import type { IPurchaseValue, TPurchaseField } from './purchase.domain';
import type { TFinanceTx } from '../../database/postgres/finance-db';
import type {
  TFinancePurchaseRow,
  TFinanceTaxPaymentRow,
} from '../../database/postgres/repositories/finance-purchase.repository';

import { Injectable } from '@nestjs/common';

import { AccountingLotRepository } from '../../database/postgres/repositories/accounting-lot.repository';
import { FinancePurchaseRepository } from '../../database/postgres/repositories/finance-purchase.repository';
import { ProductService } from '../../database/services/product.service';
import { lotsOfPurchase } from '../accounting/accounting-lots.domain';

import { isUuid } from './expense.domain';
import {
  EXTRA_WITHOUT_LINES_ERROR,
  validatePurchaseInput,
  validateTaxPaymentInput,
} from './purchase.domain';

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
 *
 * Сохранение закупки пересоздаёт её партии «Финучёта» (TASK-214) в той же
 * транзакции; ДДС их не видит. Удаление снимает партии каскадом FK.
 */
@Injectable()
export class FinancePurchasesService {
  constructor(
    private readonly repository: FinancePurchaseRepository,
    private readonly lots: AccountingLotRepository,
    private readonly products: ProductService,
  ) {}

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
    const value = purchaseValue(input);
    const productIds = await this.productIdsOf(telegramUserId, value);
    return this.repository.inTransaction(async (tx) => {
      const row = await this.repository.createPurchase(telegramUserId, value, tx);
      await this.replaceLots(telegramUserId, row, productIds, tx);
      return row;
    });
  }

  async updatePurchase(
    telegramUserId: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<TFinancePurchaseRow> {
    if (!isUuid(id)) throw new PurchaseNotFoundError();
    const value = purchaseValue(input);
    const productIds = await this.productIdsOf(telegramUserId, value);
    return this.repository.inTransaction(async (tx) => {
      const row = await this.repository.updatePurchase(telegramUserId, id, value, tx);
      if (!row) throw new PurchaseNotFoundError();
      await this.replaceLots(telegramUserId, row, productIds, tx);
      return row;
    });
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

  /** Артикул → товар; до транзакции — Mongo в неё не входит. */
  private async productIdsOf(
    telegramUserId: string,
    value: IPurchaseValue,
  ): Promise<Map<string, string>> {
    if (!value.lines?.length) return new Map();
    return this.products.resolveForPriceList(
      telegramUserId,
      value.lines.map((line) => line.sku),
    );
  }

  /**
   * Партии по сохранённой строке: при правке доставка могла остаться из базы,
   * поэтому «расходы без позиций» проверяются ещё раз — откат всей правки.
   */
  private async replaceLots(
    telegramUserId: string,
    row: TFinancePurchaseRow,
    productIds: ReadonlyMap<string, string>,
    tx: TFinanceTx,
  ): Promise<void> {
    if (!row.lines?.length && (row.deliveryKopecks > 0 || row.otherCostsKopecks > 0)) {
      throw new PurchaseValidationError('lines', EXTRA_WITHOUT_LINES_ERROR);
    }
    await this.lots.replaceForPurchase(telegramUserId, row.id, lotsOfPurchase(row, productIds), tx);
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
