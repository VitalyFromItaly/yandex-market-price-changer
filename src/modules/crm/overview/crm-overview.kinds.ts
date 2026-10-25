import type { ICrmOverviewStoreProblem } from './crm-overview.domain';
import type { TMarketplace } from '../../../shared/marketplace';
import type { IReportPeriod } from '../../yandex/reports/report-period';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { ProductService } from '../../../database/services/product.service';
import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { FinanceCashflowService } from '../../finance/finance-cashflow.service';
import { financeToday } from '../../finance/finance-period';
import { FinanceService } from '../../finance/finance.service';
import { IN_TRANSIT_STAGES, NOT_CONNECTED_TEXT } from '../../inventory/inventory.domain';
import { MarketplaceNotConnectedError } from '../../marketplaces/marketplace-adapter';
import { MarketplaceRegistry } from '../../marketplaces/marketplace-registry.service';
import { availableBySku } from '../../marketplaces/marketplace-stocks';
import {
  FEATURE,
  REPORT_TO_FEATURE,
  isFeatureEnabled,
} from '../../telegram/bots/shared/features.domain';
import { fbyStockUnavailableLine } from '../../yandex/fby/fby-message';
import { OrderReportsService } from '../../yandex/reports/order-reports.service';
import { applyDiscounts, ratesOf } from '../../yandex/reports/profit';
import { reportErrorMessage } from '../../yandex/reports/report-message';
import { DEFAULT_PERIOD, PERIOD } from '../../yandex/reports/report-period';
import { REPORT } from '../../yandex/reports/report-status-map';
import { accountStores } from '../../yandex/stores/stores.domain';
import { YandexDateRangeError } from '../../yandex/yandex-date-window';
import { CrmJobError, parseJobMarketplace, withoutIcon } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { byPurchaseKey, marketplaceAvailable, ymStocks } from '../jobs/crm-marketplace-stocks';

import {
  CANCELLED_NO_ORDERS_TEXT,
  OVERVIEW_CANCELLED_KIND,
  OVERVIEW_RANGE_INVALID_TEXT,
  OVERVIEW_STOCKS_KIND,
  OVERVIEW_SUMMARY_KIND,
  cancelledPeriodOf,
  cancelledRangeUnsupportedText,
  parseOverviewRanges,
  stockValueOf,
  toCrmOverviewSummary,
} from './crm-overview.domain';

/**
 * Три kind-а «Обзора» (TASK-125), все уровня аккаунта.
 *
 * - `overview:summary` — деньги, заказы и штуки текущего и прошлого периода из
 *   `FinanceService.build` (без плоской оценки — она для «Финансов»), плюс
 *   «к получению» из того же `FinanceCashflowService.receivable`, что у ДДС.
 *   Требует и `overview`, и `finance`: без журнала денег нет.
 * - `overview:stocks` — срез «сейчас» по всем магазинам кабинета: стоимость
 *   остатков по текущему закупу и товары в пути из отчёта «Едет до клиента».
 * - `overview:cancelled` — отмены из заказов Маркета за период, если отчёты о
 *   заказах такой период умеют.
 *
 * Магазины обходятся по очереди: квоты Partner API — на токен, а лимит отчёта
 * остатков FBY держит `FbyStockService`. Сбой магазина — строка с причиной, а
 * не ноль в сумме и не отказ всего экрана.
 *
 * Площадка — экрана (`params.marketplace`, TASK-183): /ym — журнал и магазины
 * ЯМ, как было; /ozon, /wb — журнал площадки, её остатки и заказы через реестр
 * (`stocks`, `orders`). ЯМ на экране Ozon не спрашивается вовсе. Площадка эхом в
 * ответе — по ней фронт узнаёт свой ответ.
 */
@Injectable()
export class CrmOverviewKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly finance: FinanceService,
    private readonly cashflow: FinanceCashflowService,
    private readonly marketplaces: MarketplaceRegistry,
    private readonly reports: OrderReportsService,
    private readonly purchasePrices: PurchasePriceService,
    private readonly products: ProductService,
  ) {}

  onModuleInit(): void {
    this.registry.register(OVERVIEW_SUMMARY_KIND, {
      features: [FEATURE.OVERVIEW, FEATURE.FINANCE],
      scope: 'account',
      run: (context) => this.summary(context),
    });
    this.registry.register(OVERVIEW_STOCKS_KIND, {
      features: [FEATURE.OVERVIEW],
      scope: 'account',
      run: (context) => this.stocks(context),
    });
    this.registry.register(OVERVIEW_CANCELLED_KIND, {
      features: [FEATURE.OVERVIEW],
      scope: 'account',
      run: (context) => this.cancelled(context),
    });
  }

  async summary(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const ranges = parseOverviewRanges(context.params);
    if (!ranges) throw new CrmJobError(OVERVIEW_RANGE_INVALID_TEXT);
    const marketplace = this.marketplaceOf(context);
    const { telegramUserId } = context;
    const [current, previous, receivable] = await Promise.all([
      this.finance.build(telegramUserId, ranges.current, now, { flat: false, marketplace }),
      this.finance.build(telegramUserId, ranges.previous, now, { flat: false, marketplace }),
      this.cashflow.receivable(telegramUserId, now, marketplace),
    ]);
    return { data: { ...toCrmOverviewSummary(current, previous, receivable), marketplace } };
  }

  async stocks(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const marketplace = this.marketplaceOf(context);
    if (marketplace !== 'ym') return this.marketplaceStocks(context, marketplace, now);
    const inTransitOpen = isFeatureEnabled(context.features, REPORT_TO_FEATURE[REPORT.IN_TRANSIT]);
    const deepHistory = isFeatureEnabled(context.features, FEATURE.DEEP_HISTORY);
    const stores = accountStores(context.store);
    const problems: ICrmOverviewStoreProblem[] = [];
    const total = { kopecks: 0, units: 0, withoutCost: { skus: 0, units: 0 } };
    const inTransit = { orders: 0, units: 0, salesKopecks: 0 };

    for (const store of stores) {
      try {
        const levels = await ymStocks(this.marketplaces, store, now);
        const available = availableBySku(levels);
        if (!available) {
          problems.push({
            storeName: store.name ?? '',
            problem: withoutIcon(fbyStockUnavailableLine(levels.error)),
          });
        } else {
          const skus = Object.keys(available);
          const rows = await this.purchasePrices.findBySkus(context.telegramUserId, skus);
          const value = stockValueOf(available, applyDiscounts(rows, ratesOf(store)));
          total.kopecks += value.kopecks;
          total.units += value.units;
          total.withoutCost.skus += value.withoutCost.skus;
          total.withoutCost.units += value.withoutCost.units;
        }
        if (inTransitOpen) {
          const report = await this.reports.build(store, REPORT.IN_TRANSIT, now, DEFAULT_PERIOD, {
            deepHistory,
          });
          inTransit.orders += report.count;
          inTransit.salesKopecks += Math.round(report.totals.sales * 100);
          for (const order of report.orders) {
            for (const item of order.items ?? []) inTransit.units += item.count ?? 0;
          }
        }
      } catch (error) {
        problems.push({ storeName: store.name ?? '', problem: reportErrorMessage(error) });
      }
    }

    return {
      data: {
        marketplace,
        takenAt: now.toISOString(),
        stockValueKopecks: total.kopecks,
        stockUnits: total.units,
        withoutCost: total.withoutCost,
        inTransit: inTransitOpen ? inTransit : null,
        stores: stores.length,
        problems,
      },
    };
  }

  /**
   * Срез «сейчас» Ozon/WB: остатки — по всем местам площадки, стоимость — по
   * текущему закупу карточки (артикул площадки → ключ закупа); в пути — заказы
   * площадки за её окно «всего» (последние 30 дней) по этапу. Сумма в пути
   * неизвестна, если неизвестна цена хоть одного заказа, — null, не ноль.
   */
  private async marketplaceStocks(
    context: ICrmJobContext,
    marketplace: TMarketplace,
    now: Date,
  ): Promise<ICrmJobOutput> {
    const { telegramUserId } = context;
    const storeName = MARKETPLACE_LABEL[marketplace];
    const problems: ICrmOverviewStoreProblem[] = [];
    const total = { kopecks: 0, units: 0, withoutCost: { skus: 0, units: 0 } };

    const stock = await marketplaceAvailable(this.marketplaces, telegramUserId, marketplace, now);
    if (stock.problem !== null) {
      problems.push({ storeName, problem: stock.problem });
    } else {
      const products = await this.products.findByJournalSkus(
        telegramUserId,
        marketplace,
        Object.keys(stock.available),
      );
      const available = byPurchaseKey(stock.available, products);
      const rows = await this.purchasePrices.findBySkus(telegramUserId, Object.keys(available));
      const value = stockValueOf(available, applyDiscounts(rows, ratesOf(context.store ?? {})));
      Object.assign(total, value);
    }

    let inTransit: { orders: number; units: number; salesKopecks: number | null } | null = null;
    const source = this.marketplaces.capability(marketplace, 'orders');
    if (source) {
      try {
        const { orders } = await source.listOrders(
          { telegramUserId, marketplace },
          { key: PERIOD.ALL },
          now,
        );
        const moving = orders.filter((order) => IN_TRANSIT_STAGES.has(order.stage));
        let salesKopecks: number | null = 0;
        let units = 0;
        for (const order of moving) {
          for (const item of order.items) units += item.count;
          salesKopecks =
            salesKopecks === null || order.sales === null
              ? null
              : salesKopecks + Math.round(order.sales * 100);
        }
        inTransit = { orders: moving.length, units, salesKopecks };
      } catch (error) {
        // Не подключено — уже сказано строкой остатков; второй раз не повторяем.
        if (!(error instanceof MarketplaceNotConnectedError) || stock.problem === null) {
          problems.push({ storeName, problem: reportErrorMessage(error) });
        }
      }
    }

    return {
      data: {
        marketplace,
        takenAt: now.toISOString(),
        stockValueKopecks: total.kopecks,
        stockUnits: total.units,
        withoutCost: total.withoutCost,
        inTransit,
        stores: 1,
        problems,
      },
    };
  }

  async cancelled(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const ranges = parseOverviewRanges(context.params);
    if (!ranges) throw new CrmJobError(OVERVIEW_RANGE_INVALID_TEXT);
    const marketplace = this.marketplaceOf(context);
    const { from, to } = ranges.current;
    const period = cancelledPeriodOf(ranges.current, financeToday(now));
    if (!period) {
      const data = {
        marketplace,
        from,
        to,
        count: null,
        note: cancelledRangeUnsupportedText(marketplace),
        stores: 0,
        problems: [],
      };
      return { data };
    }
    if (marketplace !== 'ym') {
      return {
        data: {
          marketplace,
          from,
          to,
          ...(await this.marketplaceCancelled(context, marketplace, period, now)),
        },
      };
    }
    const stores = accountStores(context.store);

    const deepHistory = isFeatureEnabled(context.features, FEATURE.DEEP_HISTORY);
    const problems: ICrmOverviewStoreProblem[] = [];
    let count = 0;
    for (const store of stores) {
      try {
        const placed = await this.reports.collectPlacedOrders(store, period, now, { deepHistory });
        count += placed.cancelled.length;
      } catch (error) {
        // День глубже 30 дней без deep_history — ожидаемый отказ, один на все магазины.
        if (error instanceof YandexDateRangeError) {
          const data = { marketplace, from, to, count: null, note: error.userMessage, stores: 0 };
          return { data: { ...data, problems: [] } };
        }
        problems.push({ storeName: store.name ?? '', problem: reportErrorMessage(error) });
      }
    }
    return { data: { marketplace, from, to, count, note: null, stores: stores.length, problems } };
  }

  /** Отмены Ozon/WB за период — из заказов площадки; заказов она не отдаёт — причина. */
  private async marketplaceCancelled(
    context: ICrmJobContext,
    marketplace: TMarketplace,
    period: IReportPeriod,
    now: Date,
  ): Promise<{
    count: number | null;
    note: string | null;
    stores: number;
    problems: ICrmOverviewStoreProblem[];
  }> {
    const source = this.marketplaces.capability(marketplace, 'orders');
    if (!source) {
      return { count: null, note: CANCELLED_NO_ORDERS_TEXT(marketplace), stores: 0, problems: [] };
    }
    const { telegramUserId } = context;
    try {
      const { cancelled } = await source.listOrders({ telegramUserId, marketplace }, period, now);
      return { count: cancelled.length, note: null, stores: 1, problems: [] };
    } catch (error) {
      const problem =
        error instanceof MarketplaceNotConnectedError
          ? NOT_CONNECTED_TEXT(marketplace)
          : reportErrorMessage(error);
      return {
        // Источник один — причина в подписи карточки, а не отдельной строкой.
        count: null,
        note: problem,
        stores: 1,
        problems: [],
      };
    }
  }

  /** Площадка экрана; мусор и закрытая фича площадки — отказ задачи. */
  private marketplaceOf(context: ICrmJobContext): TMarketplace {
    const parsed = parseJobMarketplace(context.params, context.features ?? {});
    if ('error' in parsed) throw new CrmJobError(parsed.text);
    return parsed.marketplace;
  }
}
