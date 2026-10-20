import type { ICrmOverviewStoreProblem } from './crm-overview.domain';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { FinanceCashflowService } from '../../finance/finance-cashflow.service';
import { financeToday } from '../../finance/finance-period';
import { FinanceService } from '../../finance/finance.service';
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
import { DEFAULT_PERIOD } from '../../yandex/reports/report-period';
import { REPORT } from '../../yandex/reports/report-status-map';
import { accountStores } from '../../yandex/stores/stores.domain';
import { YandexDateRangeError } from '../../yandex/yandex-date-window';
import { CrmJobError, withoutIcon } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { ymStocks } from '../jobs/crm-marketplace-stocks';

import {
  CANCELLED_RANGE_UNSUPPORTED_TEXT,
  OVERVIEW_CANCELLED_KIND,
  OVERVIEW_RANGE_INVALID_TEXT,
  OVERVIEW_STOCKS_KIND,
  OVERVIEW_SUMMARY_KIND,
  cancelledPeriodOf,
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
    const { telegramUserId } = context;
    const [current, previous, receivable] = await Promise.all([
      this.finance.build(telegramUserId, ranges.current, now, { flat: false }),
      this.finance.build(telegramUserId, ranges.previous, now, { flat: false }),
      this.cashflow.receivable(telegramUserId, now),
    ]);
    return { data: toCrmOverviewSummary(current, previous, receivable) };
  }

  async stocks(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
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

  async cancelled(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const ranges = parseOverviewRanges(context.params);
    if (!ranges) throw new CrmJobError(OVERVIEW_RANGE_INVALID_TEXT);
    const { from, to } = ranges.current;
    const period = cancelledPeriodOf(ranges.current, financeToday(now));
    const stores = accountStores(context.store);
    if (!period) {
      const data = {
        from,
        to,
        count: null,
        note: CANCELLED_RANGE_UNSUPPORTED_TEXT,
        stores: 0,
        problems: [],
      };
      return { data };
    }

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
          return {
            data: { from, to, count: null, note: error.userMessage, stores: 0, problems: [] },
          };
        }
        problems.push({ storeName: store.name ?? '', problem: reportErrorMessage(error) });
      }
    }
    return { data: { from, to, count, note: null, stores: stores.length, problems } };
  }
}
