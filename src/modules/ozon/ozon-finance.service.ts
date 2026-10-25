import type { IOzonProduct, OzonSellerClient } from './ozon.client';
import type { TFinanceImportResult } from '../finance/finance-import.service';
import type { IFinancePeriod } from '../finance/finance-period';
import type { IOzonDayPayout } from '../finance/ozon-payouts';

import { Injectable, Logger } from '@nestjs/common';

import { FinanceOperationRepository } from '../../database/postgres/repositories/finance-operation.repository';
import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { ProductService } from '../../database/services/product.service';
import { ErrorReporter } from '../errors/error-reporter.service';
import { FinanceImportService } from '../finance/finance-import.service';
import { financeToday, requestRange, shiftDay } from '../finance/finance-period';
import {
  ozonAccrualToRow,
  ozonAccrualTypesMap,
  ozonAccrualsHaveSkus,
  ozonAccrualsInPeriod,
  ozonFinanceOriginal,
  reportOzonUnknownArticles,
} from '../finance/ozon-journal';
import { ozonPaidDays } from '../finance/ozon-payouts';

import { OzonClientFactory } from './ozon-client.factory';
import { ozonReconcileOrders } from './ozon-reconcile-orders';
import { ozonSellerClient } from './ozon-seller-client';

/** Место сбоя каталога при импорте — без id, довод троттлинга алертов. */
export const OZON_FINANCE_SKU_CONTEXT = 'finance:ozon-sku';

/** Место сбоя раскладки выплат (TASK-184) — без id, довод троттлинга алертов. */
export const OZON_PAYOUTS_CONTEXT = 'finance:ozon-payouts';

const moscowStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

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
 * Импорт финансовых операций Ozon (TASK-131, TASK-194): начисления
 * /v1/finance/accrual/by-day по дням месяца + справочник типов → строки
 * журнала → та же версия, upsert и корректировки, что у ЯМ
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
    private readonly operations: FinanceOperationRepository,
  ) {}

  async importPeriod(
    telegramUserId: string,
    period: IFinancePeriod,
    now: Date = new Date(),
  ): Promise<TFinanceImportResult> {
    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const credentials = await this.connections.credentialsOf(telegramUserId, 'ozon');
    const clientId = credentials?.clientId ?? '';

    const result = await this.imports.importBatchAndRecord(
      { telegramUserId, period, marketplace: 'ozon' },
      async () => {
        // Незакрытый месяц — по сегодня, хранится целым (довод requestRange).
        const range = requestRange(period, financeToday(now));
        const raws = await client.listAccruals(range.from, range.to);
        const { accruals, dropped } = ozonAccrualsInPeriod(raws, period);
        if (dropped) {
          this.logger.warn(
            `Ozon ${telegramUserId} ${period.from}…${period.to}: вне периода ${dropped} начислений — пропущены`,
          );
        }
        if (!accruals.length) return null;

        // Справочник — после начислений: пустой период его не запрашивает.
        const types = ozonAccrualTypesMap(await client.listAccrualTypes());
        const keys = ozonAccrualsHaveSkus(accruals)
          ? await this.purchaseKeys(telegramUserId, () => client.listProducts())
          : new Map<string, string>();
        return {
          businessId: clientId,
          original: {
            buffer: ozonFinanceOriginal(period, accruals, types, (sku) => keys.get(sku)),
            filename: `ozon-accruals-${period.from}-${period.to}.json`,
            contentType: 'application/json',
          },
          toOperations: (ctx) =>
            accruals.map((raw) => ozonAccrualToRow(raw, ctx, types, (sku) => keys.get(sku))),
          reportUnknown: (rows) => reportOzonUnknownArticles(this.errors, rows, telegramUserId),
          refreshSku: true,
          // paidAt ставит раскладка выплат ниже — новая версия его не стирает.
          keepPayment: true,
          orders: ozonReconcileOrders(client, now),
        };
      },
      now,
    );
    // И при `unchanged`: начисления те же, а выплаты могли прийти новые.
    if (result.status !== 'empty') await this.assignPayouts(telegramUserId, period, client, now);
    return result;
  }

  /**
   * Выплаты Ozon → `paidAt` строк месяца (TASK-184): сальдо по дням от начала
   * месяца по сегодня, раскладка FIFO (`ozonPaidDays`). Дни — последовательно
   * (довод `listAccruals`) и до первого дня, когда покрыто всё. Запись
   * авторитетна для строк месяца: непокрытые — `null` (выплат до сегодня нет).
   *
   * Сбой — алерт, журнал как есть: начисления уже записаны и важнее, а
   * следующий импорт (ночной) разложит заново.
   */
  private async assignPayouts(
    telegramUserId: string,
    period: IFinancePeriod,
    client: Pick<OzonSellerClient, 'balanceOfDay'>,
    now: Date,
  ): Promise<void> {
    try {
      const lines = await this.operations.liveForPayout(
        telegramUserId,
        moscowStart(period.from),
        moscowStart(shiftDay(period.to, 1)),
        'ozon',
      );
      if (!lines.length) return;

      const today = financeToday(now);
      const payouts: IOzonDayPayout[] = [];
      let opening = 0;
      let allocation = ozonPaidDays(lines, opening, payouts);
      for (let day = period.from; day <= today && allocation.uncovered > 0; ) {
        const balance = await client.balanceOfDay(day);
        if (day === period.from) opening = balance.openingKopecks;
        if (balance.paymentsKopecks > 0) {
          payouts.push({ day, kopecks: balance.paymentsKopecks });
          allocation = ozonPaidDays(lines, opening, payouts);
        }
        day = shiftDay(day, 1);
      }

      const paidAt = new Map<string, Date | null>();
      for (const line of lines) {
        const day = allocation.paid.get(line.id);
        paidAt.set(line.id, day ? moscowStart(day) : null);
      }
      await this.operations.setPaidAt(telegramUserId, 'ozon', paidAt);
      this.logger.log(
        `Выплаты Ozon ${telegramUserId} ${period.from}…${period.to}: выплат ${payouts.length}, ` +
          `строк выплачено ${allocation.paid.size}, ждут выплаты ${allocation.uncovered}`,
      );
    } catch (error) {
      void this.errors.report({
        error,
        telegramUserId,
        source: 'queue',
        context: OZON_PAYOUTS_CONTEXT,
      });
    }
  }

  /**
   * Ключи закупа для SKU начислений. Каталог не ответил — алерт и пустая
   * карта: операции важнее себестоимости, строки лягут с сырым SKU Ozon
   * («без закупа»), а следующий импорт допишет артикул (`refreshSku`).
   */
  private async purchaseKeys(
    telegramUserId: string,
    listProducts: () => Promise<IOzonProduct[]>,
  ): Promise<Map<string, string>> {
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
