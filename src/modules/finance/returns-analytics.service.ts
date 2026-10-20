import type { IFinancePeriod } from './finance-period';
import type { IReturnsAnalytics } from './returns-analytics';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { IBrandSource } from '../yandex/reports/brands';

import { Injectable } from '@nestjs/common';

import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { ProductService } from '../../database/services/product.service';

import { assertFinancePeriod } from './finance-period';
import { periodLinesOf, returnedOrderIdsOf, returnsAnalyticsOf } from './returns-analytics';

const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
const DAY_MS = 86_400_000;

/**
 * «Аналитика возвратов» (TASK-145): журнал площадки за период → возвраты.
 * Два чтения журнала: строки периода (`liveForPnl`, тот же ридер, что у P&L) и
 * все строки возвращённых заказов за любые даты (`liveByOrderIds`, как у
 * «Ленты заказов») — по ним невозвращённая комиссия нетто по заказу. Правило —
 * в `returnsAnalyticsOf`; здесь только чтение.
 */
@Injectable()
export class ReturnsAnalyticsService {
  constructor(
    private readonly operations: FinanceOperationRepository,
    private readonly products: ProductService,
  ) {}

  async build(
    telegramUserId: string,
    marketplace: TFinanceMarketplace,
    period: IFinancePeriod,
  ): Promise<IReturnsAnalytics> {
    assertFinancePeriod(period);
    const from = moscowStart(period.from);
    const to = new Date(moscowStart(period.to).getTime() + DAY_MS);
    const operations = await this.operations.liveForPnl(telegramUserId, from, to, marketplace);
    const lines = periodLinesOf(operations, period);
    const orderIds = returnedOrderIdsOf(lines);
    const orderOperations = orderIds.length
      ? await this.operations.liveByOrderIds(telegramUserId, orderIds, marketplace)
      : [];

    // Артикул журнала у всех площадок — ключ закупа (артикул ЯМ товара), как у P&L.
    const skus = [...new Set(lines.map((line) => line.sku).filter(Boolean))] as string[];
    const found = skus.length ? await this.products.findByYmSkus(telegramUserId, skus) : [];
    const products = new Map<string, IBrandSource>();
    for (const product of found) {
      const ym = product.marketplaceSkus?.ym;
      if (ym) products.set(ym, { name: product.name, category: product.category });
    }

    return returnsAnalyticsOf({ marketplace, period, lines, orderOperations, products });
  }
}
