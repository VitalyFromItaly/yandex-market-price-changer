import type {
  IAccountingCostRecord,
  TAccountingCostAt,
  TCostCorrectionField,
} from './accounting-cost-history.domain';
import type {
  IAccountingCostActor,
  IAccountingCostCorrectionResult,
  TAccountingCostChangeRow,
  TAccountingCostRow,
} from '../../database/postgres/repositories/accounting-cost-history.repository';
import type { IProductPriceRow } from '../products/product.domain';

import { Injectable, Logger } from '@nestjs/common';

import {
  AccountingCostHistoryRepository,
  costRecordOf,
} from '../../database/postgres/repositories/accounting-cost-history.repository';
import { ProductService } from '../../database/services/product.service';

import {
  accountingCostAt,
  priceListCostWrites,
  validateCostCorrection,
} from './accounting-cost-history.domain';

/** Ввод исправления не прошёл проверку — `field` говорит, под каким полем показать. */
export class CostCorrectionValidationError extends Error {
  constructor(
    readonly field: TCostCorrectionField,
    message: string,
  ) {
    super(message);
    this.name = 'CostCorrectionValidationError';
  }
}

/** Товара нет — или он чужой: для продавца это одно и то же. */
export class CostHistoryProductNotFoundError extends Error {
  constructor(message = 'Товар не найден') {
    super(message);
    this.name = 'CostHistoryProductNotFoundError';
  }
}

export interface IAccountingCostHistoryView {
  records: TAccountingCostRow[];
  changes: TAccountingCostChangeRow[];
}

/** Продажа, себестоимость которой ищется: товар и момент. */
export interface IAccountingCostQuery {
  productId: string;
  moment: Date;
}

/**
 * История закупа v2 «Финучёта» (ТЗ п.2, TASK-213) — единственная дверь к ней.
 * Своя таблица, текущая «Прибыль» (`CostHistory`, `costOn`, `cogsOf`) её не видит.
 * Отдельный модуль (`AccountingCostHistoryModule`): её зовёт загрузка прайса в
 * `YandexModule`, а `AccountingModule` сам импортирует `YandexModule`.
 */
@Injectable()
export class AccountingCostHistoryService {
  private readonly logger = new Logger(AccountingCostHistoryService.name);

  constructor(
    private readonly repository: AccountingCostHistoryRepository,
    private readonly products: ProductService,
  ) {}

  /**
   * Загрузка прайса: записи v2 только по изменившимся товарам, начало — `now`.
   * `previous` — закуп `PurchasePrice` ДО загрузки. Возвращает число записей.
   */
  async recordPriceList(
    telegramUserId: string,
    rows: readonly IProductPriceRow[],
    previous: ReadonlyMap<string, { price: number }>,
    now: Date = new Date(),
  ): Promise<number> {
    if (!rows.length) return 0;
    const productIds = await this.products.resolveForPriceList(
      telegramUserId,
      rows.map((row) => row.sku),
    );
    const records = await this.recordsOf(telegramUserId, [...productIds.values()]);
    const writes = priceListCostWrites(rows, { productIds, records, previous }, now);
    const inserted = await this.repository.insertMany(telegramUserId, writes);
    if (inserted) this.logger.log(`История закупа v2 ${telegramUserId}: записей ${inserted}`);
    return inserted;
  }

  /** Записи товаров для правил домена: id товара → записи. */
  async recordsOf(
    telegramUserId: string,
    productIds: readonly string[],
  ): Promise<Map<string, IAccountingCostRecord[]>> {
    const rows = await this.repository.recordsFor(telegramUserId, productIds);
    const result = new Map<string, IAccountingCostRecord[]>();
    for (const [productId, list] of rows) result.set(productId, list.map(costRecordOf));
    return result;
  }

  /** Закуп товара на момент продажи; нет записи до момента — `unknown`. */
  async costAt(
    telegramUserId: string,
    productId: string,
    moment: Date,
  ): Promise<TAccountingCostAt> {
    const [result] = await this.costsAt(telegramUserId, [{ productId, moment }]);
    return result;
  }

  /** То же пачкой, одним запросом — в порядке запросов. */
  async costsAt(
    telegramUserId: string,
    queries: readonly IAccountingCostQuery[],
  ): Promise<TAccountingCostAt[]> {
    const records = await this.recordsOf(
      telegramUserId,
      queries.map((query) => query.productId),
    );
    return queries.map((query) => accountingCostAt(records.get(query.productId), query.moment));
  }

  /** Записи товара и журнал исправлений; чужой товар — ошибка «не найден». */
  async history(telegramUserId: string, productId: string): Promise<IAccountingCostHistoryView> {
    await this.ownedOrThrow(telegramUserId, productId);
    const records = await this.repository.recordsFor(telegramUserId, [productId]);
    return {
      records: records.get(productId) ?? [],
      changes: await this.repository.changes(telegramUserId, productId),
    };
  }

  /** Исправление прошлой цены: проверка формы → запись + журнал было/стало/автор/причина. */
  async correct(
    telegramUserId: string,
    productId: string,
    input: Record<string, unknown>,
    actor: IAccountingCostActor,
    now: Date = new Date(),
  ): Promise<IAccountingCostCorrectionResult> {
    await this.ownedOrThrow(telegramUserId, productId);
    const checked = validateCostCorrection(input, now);
    if (checked.ok === false)
      throw new CostCorrectionValidationError(checked.field, checked.message);
    const result = await this.repository.correct(telegramUserId, productId, checked, actor);
    if (result.action !== 'noop') {
      this.logger.log(
        `Исправление закупа v2 ${telegramUserId}/${productId}: ${result.action} ` +
          `с ${checked.validFrom.toISOString()}`,
      );
    }
    return result;
  }

  private async ownedOrThrow(telegramUserId: string, productId: string): Promise<void> {
    const product = await this.products.findOwned(telegramUserId, productId);
    if (!product) throw new CostHistoryProductNotFoundError();
  }
}
