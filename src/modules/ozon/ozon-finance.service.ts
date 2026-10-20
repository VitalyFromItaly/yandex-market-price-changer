import type { IOzonProduct } from './ozon.client';
import type { TFinanceImportResult } from '../finance/finance-import.service';
import type { IFinancePeriod } from '../finance/finance-period';

import { Injectable, Logger } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { ProductService } from '../../database/services/product.service';
import { ErrorReporter } from '../errors/error-reporter.service';
import { FinanceImportService } from '../finance/finance-import.service';
import { financeToday, requestRange } from '../finance/finance-period';
import {
  ozonFinanceOriginal,
  ozonIdOf,
  ozonOperationToRow,
  ozonOperationsInPeriod,
  reportOzonUnknownArticles,
} from '../finance/ozon-journal';

import { OzonClientFactory } from './ozon-client.factory';
import { ozonReconcileOrders } from './ozon-reconcile-orders';
import { ozonSellerClient } from './ozon-seller-client';

/** Место сбоя каталога при импорте — без id, довод троттлинга алертов. */
export const OZON_FINANCE_SKU_CONTEXT = 'finance:ozon-sku';

/**
 * SKU Ozon → ключ закупа (решение владельца 2026-10-18). Цепочка: SKU Ozon →
 * `offer_id` карточки (каталог Ozon) → товар с этой карточкой → его артикул
 * ЯМ, потому что закуп и история себестоимости ищутся по артикулу ЯМ
 * (`PurchasePrice.sku`, `CostHistoryService.findForSkus`). Товар без карточки
 * ЯМ — сам `offer_id`: у продавца он часто совпадает с артикулом ЯМ, а не
 * совпал — строка честно «без закупа».
 */
export function ozonPurchaseKeys(
  products: readonly Pick<IOzonProduct, 'offerId' | 'sku' | 'skus'>[],
  ymSkuOfOffer: ReadonlyMap<string, string>,
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const product of products) {
    if (!product.offerId) continue;
    const key = ymSkuOfOffer.get(product.offerId) ?? product.offerId;
    for (const sku of new Set([...(product.skus ?? []), product.sku ?? ''])) {
      if (sku) keys.set(sku, key);
    }
  }
  return keys;
}

/**
 * Импорт финансовых операций Ozon (TASK-131): /v3/finance/transaction/list за
 * месяц → строки журнала → та же версия, upsert и корректировки, что у ЯМ
 * (`FinanceImportService.importBatchAndRecord`). Только чтение у Ozon.
 *
 * Ключ продавца — на каждый вызов (`ozonSellerClient`); нет ключа —
 * `OzonNotConnectedError` ДО записи статуса: «не подключён» — не сбой периода.
 */
@Injectable()
export class OzonFinanceService {
  private readonly logger = new Logger(OzonFinanceService.name);

  constructor(
    private readonly clients: OzonClientFactory,
    private readonly connections: MarketplaceConnectionService,
    private readonly products: ProductService,
    private readonly imports: FinanceImportService,
    private readonly errors: ErrorReporter,
  ) {}

  async importPeriod(
    telegramUserId: string,
    period: IFinancePeriod,
    now: Date = new Date(),
  ): Promise<TFinanceImportResult> {
    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const credentials = await this.connections.credentialsOf(telegramUserId, 'ozon');
    const clientId = credentials?.clientId ?? '';

    return await this.imports.importBatchAndRecord(
      { telegramUserId, period, marketplace: 'ozon' },
      async () => {
        // Незакрытый месяц — по сегодня, хранится целым (довод requestRange).
        const range = requestRange(period, financeToday(now));
        const raws = await client.listFinanceOperations(
          new Date(`${range.from}T00:00:00+03:00`),
          new Date(`${range.to}T23:59:59.999+03:00`),
        );
        const { ops, dropped } = ozonOperationsInPeriod(raws, period);
        if (dropped) {
          this.logger.warn(
            `Ozon ${telegramUserId} ${period.from}…${period.to}: вне периода ${dropped} операций — пропущены`,
          );
        }
        if (!ops.length) return null;

        const keys = await this.purchaseKeys(telegramUserId, ops, () => client.listProducts());
        return {
          businessId: clientId,
          original: {
            buffer: ozonFinanceOriginal(period, ops, (sku) => keys.get(sku)),
            filename: `ozon-transactions-${period.from}-${period.to}.json`,
            contentType: 'application/json',
          },
          toOperations: (ctx) =>
            ops.map((raw) => ozonOperationToRow(raw, ctx, (sku) => keys.get(sku))),
          reportUnknown: (rows) => reportOzonUnknownArticles(this.errors, rows, telegramUserId),
          refreshSku: true,
          orders: ozonReconcileOrders(client, now),
        };
      },
      now,
    );
  }

  /**
   * Ключи закупа для SKU операций. Каталог не ответил — алерт и пустая
   * карта: операции важнее себестоимости, строки лягут с сырым SKU Ozon
   * («без закупа»), а следующий импорт допишет артикул (`refreshSku`).
   */
  private async purchaseKeys(
    telegramUserId: string,
    ops: readonly Record<string, unknown>[],
    listProducts: () => Promise<IOzonProduct[]>,
  ): Promise<Map<string, string>> {
    const hasItems = ops.some(
      (op) =>
        Array.isArray(op.items) &&
        op.items.some((item) => ozonIdOf((item as Record<string, unknown> | null)?.sku)),
    );
    if (!hasItems) return new Map();
    try {
      const catalog = await listProducts();
      const linked = await this.products.findByMarketplaceSkus(
        telegramUserId,
        'ozon',
        catalog.map((product) => product.offerId).filter(Boolean),
      );
      const ymSkuOfOffer = new Map<string, string>();
      for (const product of linked) {
        const offerId = product.marketplaceSkus?.ozon;
        const ymSku = product.marketplaceSkus?.ym;
        if (offerId && ymSku) ymSkuOfOffer.set(offerId, ymSku);
      }
      return ozonPurchaseKeys(catalog, ymSkuOfOffer);
    } catch (error) {
      void this.errors.report({
        error,
        telegramUserId,
        source: 'queue',
        context: OZON_FINANCE_SKU_CONTEXT,
      });
      return new Map();
    }
  }
}
