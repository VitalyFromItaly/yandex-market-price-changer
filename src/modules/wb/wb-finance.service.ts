import type { TFinanceImportResult } from '../finance/finance-import.service';
import type { IFinancePeriod } from '../finance/finance-period';

import { Injectable, Logger } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { ProductService } from '../../database/services/product.service';
import { ErrorReporter } from '../errors/error-reporter.service';
import { FinanceImportService } from '../finance/finance-import.service';
import { financeToday, requestRange, shiftDay } from '../finance/finance-period';
import {
  reportWbUnknownArticles,
  wbFinanceOriginal,
  wbPayoutByReport,
  wbRowToOperation,
  wbRowsInPeriod,
} from '../finance/wb-journal';

import { WbClientFactory } from './wb-client.factory';
import { wbSellerClient } from './wb-seller-client';

/** Место сбоя поиска товаров при импорте — без id, довод троттлинга алертов. */
export const WB_FINANCE_SKU_CONTEXT = 'finance:wb-sku';

/**
 * Запас запроса вокруг месяца, дней: недельный отчёт пересекает границу, а по
 * какой дате WB отбирает строки (`rr_dt` или даты отчёта), не сверено. С
 * запасом в журнал месяца попадают все строки с его `rr_dt` при любом толковании.
 */
export const WB_REPORT_MARGIN_DAYS = 6;

/**
 * Артикул продавца WB → ключ закупа: товар, к которому привязана карточка WB
 * с этим `vendorCode`, → его артикул ЯМ (закуп и история себестоимости ищутся
 * по нему); нет — сам артикул продавца (довод `ozonPurchaseKeys`).
 */
export function wbPurchaseKeys(
  linked: readonly { marketplaceSkus?: { wb?: string; ym?: string } }[],
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const product of linked) {
    const vendorCode = product.marketplaceSkus?.wb;
    const ymSku = product.marketplaceSkus?.ym;
    if (vendorCode && ymSku) keys.set(vendorCode, ymSku);
  }
  return keys;
}

/**
 * Импорт отчёта реализации WB (TASK-136): sales-reports/detailed за месяц →
 * строки журнала → та же версия, upsert и корректировки, что у ЯМ и Ozon
 * (`FinanceImportService.importBatchAndRecord`). Только чтение у WB. Выплата
 * (TASK-185) — из самой строки (`wbPaidAtOf`), отдельного прохода, как у Ozon, нет.
 *
 * Токен — на каждый вызов (`wbSellerClient`); нет токена —
 * `WbNotConnectedError` ДО записи статуса: «не подключён» — не сбой периода.
 */
@Injectable()
export class WbFinanceService {
  private readonly logger = new Logger(WbFinanceService.name);

  constructor(
    private readonly clients: WbClientFactory,
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
    const client = await wbSellerClient(this.clients, this.connections, telegramUserId);
    // Кабинет WB — продавец токена (`sid` из проверки подключения), как clientId у Ozon.
    const connection = await this.connections.findOne(telegramUserId, 'wb');
    const sellerId = connection?.accounts[0]?.id ?? '';

    return await this.imports.importBatchAndRecord(
      { telegramUserId, period, marketplace: 'wb' },
      async () => {
        const today = financeToday(now);
        const range = requestRange(
          {
            from: shiftDay(period.from, -WB_REPORT_MARGIN_DAYS),
            to: shiftDay(period.to, WB_REPORT_MARGIN_DAYS),
          },
          today,
        );
        const raws = await client.listRealizationReport(range.from, range.to);
        const { rows, dropped } = wbRowsInPeriod(raws, period);
        if (dropped) {
          this.logger.log(
            `WB ${telegramUserId} ${period.from}…${period.to}: вне месяца ${dropped} строк — в соседний`,
          );
        }
        if (!rows.length) return null;

        const keys = await this.purchaseKeys(telegramUserId, rows);
        const skuOf = (vendorCode: string) => keys.get(vendorCode);
        // Сумма поручения — по всему ответу, до фильтра месяца: строки отчёта на
        // стыке лежат в двух месяцах, а запрос с запасом накрывает неделю целиком.
        const payouts = wbPayoutByReport(raws);
        const payoutOf = (reportId: string) => payouts.get(reportId);
        return {
          businessId: sellerId,
          original: {
            buffer: wbFinanceOriginal(period, rows, skuOf),
            filename: `wb-realization-${period.from}-${period.to}.json`,
            contentType: 'application/json',
          },
          toOperations: (ctx) => rows.map((raw) => wbRowToOperation(raw, ctx, skuOf, payoutOf)),
          reportUnknown: (ops) => reportWbUnknownArticles(this.errors, ops, telegramUserId),
          refreshSku: true,
        };
      },
      now,
    );
  }

  /**
   * Ключи закупа по артикулам строк. Каталог WB не нужен — `sa_name` уже в
   * строке. База не ответила — алерт и пустая карта: строки лягут с артикулом
   * продавца, следующий импорт допишет ключ (`refreshSku`).
   */
  private async purchaseKeys(
    telegramUserId: string,
    rows: readonly Record<string, unknown>[],
  ): Promise<Map<string, string>> {
    const vendorCodes = [
      ...new Set(
        rows
          .map((row) => (typeof row.sa_name === 'string' ? row.sa_name.trim() : ''))
          .filter(Boolean),
      ),
    ];
    if (!vendorCodes.length) return new Map();
    try {
      return wbPurchaseKeys(
        await this.products.findByMarketplaceSkus(telegramUserId, 'wb', vendorCodes),
      );
    } catch (error) {
      void this.errors.report({
        error,
        telegramUserId,
        source: 'queue',
        context: WB_FINANCE_SKU_CONTEXT,
      });
      return new Map();
    }
  }
}
