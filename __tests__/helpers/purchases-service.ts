import type { TFinanceDb } from '../../src/database/postgres/finance-db';
import type { ProductService } from '../../src/database/services/product.service';

import { AccountingLotRepository } from '../../src/database/postgres/repositories/accounting-lot.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FinancePurchasesService } from '../../src/modules/finance/finance-purchases.service';

/**
 * Сопоставление артикулов позиций с товарами: `sku → productId`. По умолчанию
 * пусто — ни один артикул не сопоставлен (партии с productId null).
 */
export function productsStub(bySku: Record<string, string> = {}): ProductService {
  return {
    resolveForPriceList: async (_telegramUserId: string, skus: readonly string[]) =>
      new Map(skus.filter((sku) => bySku[sku]).map((sku) => [sku, bySku[sku]])),
  } as unknown as ProductService;
}

/** `FinancePurchasesService` на тестовой базе (TASK-214: закупка + партии). */
export function purchasesServiceOf(
  db: TFinanceDb,
  products: ProductService = productsStub(),
): FinancePurchasesService {
  return new FinancePurchasesService(
    new FinancePurchaseRepository(db),
    new AccountingLotRepository(db),
    products,
  );
}
