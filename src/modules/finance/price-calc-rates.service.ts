import type { IPnlSku } from './pnl-sku';
import type { IPriceCalcRates, IPriceCalcSkuRates } from './price-calc-rates';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { ProductService } from '../../database/services/product.service';
import { PurchasePriceService } from '../../database/services/purchase-price.service';
import { applyDiscounts, ratesOf } from '../yandex/reports/profit';

import { FinanceTaxService } from './finance-tax.service';
import { FinanceService } from './finance.service';
import {
  accountRatesOf,
  calcSkuOf,
  calcSkuWithoutSales,
  calcTaxOf,
  priceCalcWindow,
  RATE_SOURCE_LABEL,
  toPriceCalcRates,
} from './price-calc-rates';

/**
 * Ставки «Калькулятора цен» (TASK-139) — одна сборка на экран CRM
 * (`price-calc:rates`) и ИИ-инструмент `getPriceFor` (TASK-165). Один
 * `FinanceService.build` за окно без плоской оценки, как у unit-экономики;
 * закуп — текущий из прайса со скидками бренда, тем же, чем считает «Прибыль».
 *
 * Скидки брендов — поля документа магазина уровня аккаунта (`scopeStore`
 * их не меняет), поэтому магазин приходит готовым от вызывающего.
 */
@Injectable()
export class PriceCalcRatesService {
  constructor(
    private readonly finance: FinanceService,
    private readonly taxes: FinanceTaxService,
    private readonly products: ProductService,
    private readonly purchasePrices: PurchasePriceService,
  ) {}

  async build(
    telegramUserId: string,
    store: YandexMarketDocument | null,
    now: Date = new Date(),
  ): Promise<IPriceCalcRates> {
    const { window, skus, tax } = await this.fact(telegramUserId, now);
    const { names, priceList } = await this.catalog(
      telegramUserId,
      store,
      skus.map((sku) => sku.sku),
    );
    return toPriceCalcRates({ window, skus, names, priceList, tax });
  }

  /** Один товар — та же строка, что у `build`; без продаж в окне — средние аккаунта. */
  async forSku(
    telegramUserId: string,
    store: YandexMarketDocument | null,
    sku: string,
    now: Date = new Date(),
  ): Promise<IPriceCalcSkuRates> {
    const { window, skus, tax } = await this.fact(telegramUserId, now);
    const { names, priceList } = await this.catalog(telegramUserId, store, [sku]);
    const account = accountRatesOf(skus);
    const row = skus.find((s) => s.sku === sku);
    const name = names.get(sku) ?? null;
    return {
      window,
      tax,
      sku: row
        ? calcSkuOf(row, account, name, priceList.get(sku))
        : calcSkuWithoutSales(sku, account, name, priceList.get(sku)),
      sourceLabels: RATE_SOURCE_LABEL,
    };
  }

  private async fact(telegramUserId: string, now: Date) {
    const window = priceCalcWindow(now);
    const [report, tax] = await Promise.all([
      this.finance.build(telegramUserId, window, now, { flat: false }),
      this.taxes.snapshot(telegramUserId),
    ]);
    const skus: IPnlSku[] = report.pnl.skus.skus;
    return { window, skus, tax: calcTaxOf(tax.settings, tax.isDefault) };
  }

  private async catalog(
    telegramUserId: string,
    store: YandexMarketDocument | null,
    ids: readonly string[],
  ): Promise<{ names: Map<string, string>; priceList: Map<string, number> }> {
    const names = new Map<string, string>();
    const priceList = new Map<string, number>();
    if (!ids.length) return { names, priceList };
    const [products, rows] = await Promise.all([
      this.products.findByYmSkus(telegramUserId, ids),
      this.purchasePrices.findBySkus(telegramUserId, ids),
    ]);
    for (const product of products) {
      const ym = product.marketplaceSkus?.ym;
      if (ym && product.name) names.set(ym, product.name);
    }
    // Текущий закуп со скидками бренда — то же, чем считает «Прибыль».
    for (const [sku, rub] of applyDiscounts(rows, ratesOf(store ?? {}))) {
      priceList.set(sku, Math.round(rub * 100));
    }
    return { names, priceList };
  }
}
