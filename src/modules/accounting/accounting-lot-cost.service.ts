import type { IFifoAllocation, IFifoLot, IFifoSale, TLotSaleCost } from './accounting-lots.domain';
import type { TOrderLotCostOf } from './order-result';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TAccountingLotWithSupplier } from '../../database/postgres/repositories/accounting-lot.repository';

import { Injectable } from '@nestjs/common';

import { AccountingLotRepository } from '../../database/postgres/repositories/accounting-lot.repository';
import { AccountingOrderLineRepository } from '../../database/postgres/repositories/accounting-order-line.repository';
import { ProductService } from '../../database/services/product.service';

import { fifoAllocateWithRemaining } from './accounting-lots.domain';
import { lineValueOf } from './accounting-order-lines.domain';
import { fifoSaleOf, orderLineKeyOf } from './order-result';

const idOf = (product: object): string => String((product as { _id?: unknown })._id);

const NO_LINE: TLotSaleCost = { status: 'unknown', reason: 'no-product', returned: null };

/** Партия для экрана: строка базы с поставщиком, `remaining` — из FIFO. */
export type IAccountingLotRemaining = TAccountingLotWithSupplier;

/**
 * Себестоимость режима Б (TASK-215): FIFO с нуля по всем партиям и всем
 * позициям продавца, по всем площадкам — склад один (решение
 * `accounting_lots_storage`: остаток партии в базе не истина, правка закупки
 * пересоздаёт её партии). Товар позиции — `findByJournalSkus` (как у режима А),
 * товар партии — `productId`, записанный при сохранении закупки
 * (`resolveForPriceList`): оба — `_id` одного документа `Product`.
 */
@Injectable()
export class AccountingLotCostService {
  constructor(
    private readonly lots: AccountingLotRepository,
    private readonly orderLines: AccountingOrderLineRepository,
    private readonly products: ProductService,
  ) {}

  async lotCostResolver(telegramUserId: string): Promise<TOrderLotCostOf> {
    const lots = await this.lots.listForUser(telegramUserId);
    const { costs } = await this.allocate(telegramUserId, lots);
    return (line) => costs.get(orderLineKeyOf(line)) ?? NO_LINE;
  }

  /**
   * Партии продавца с остатком (TASK-216) — остаток из того же FIFO, что
   * себестоимость режима Б, а не колонка `remaining` (она не истина).
   */
  async lotsWithRemaining(telegramUserId: string): Promise<IAccountingLotRemaining[]> {
    const lots = await this.lots.listForUserWithSupplier(telegramUserId);
    const { remaining } = await this.allocate(telegramUserId, lots);
    return lots.map((lot) => ({ ...lot, remaining: remaining.get(lot.id) ?? lot.count }));
  }

  private async allocate(
    telegramUserId: string,
    lots: readonly IFifoLot[],
  ): Promise<IFifoAllocation> {
    const rows = await this.orderLines.allForUser(telegramUserId);
    const lines = rows.map((row) => ({
      ...lineValueOf(row),
      marketplace: row.marketplace,
      orderId: row.orderId,
      itemId: row.itemId,
    }));

    const productOf = new Map<string, string>();
    const marketplaces = [...new Set(lines.map((line) => line.marketplace))];
    for (const marketplace of marketplaces) {
      const skus = [
        ...new Set(
          lines
            .filter((line) => line.marketplace === marketplace && line.offerId)
            .map((line) => line.offerId),
        ),
      ];
      if (!skus.length) continue;
      const bySku = await this.products.findByJournalSkus(telegramUserId, marketplace, skus);
      for (const [sku, product] of bySku) productOf.set(`${marketplace}|${sku}`, idOf(product));
    }
    const productIdOf = (marketplace: TFinanceMarketplace, sku: string | null) =>
      (sku ? productOf.get(`${marketplace}|${sku}`) : undefined) ?? null;

    const sales: IFifoSale[] = [];
    for (const line of lines) {
      const sale = fifoSaleOf(line, productIdOf(line.marketplace, line.offerId));
      if (sale) sales.push(sale);
    }
    return fifoAllocateWithRemaining(
      lots.map((lot) => ({
        id: lot.id,
        productId: lot.productId,
        count: lot.count,
        unitPriceKopecks: lot.unitPriceKopecks,
        extraKopecks: lot.extraKopecks,
        receivedDay: lot.receivedDay,
      })),
      sales,
    );
  }
}
