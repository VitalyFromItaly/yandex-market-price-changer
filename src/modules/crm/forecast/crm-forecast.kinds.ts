import type { ICrmForecastPurchases, ICrmStoreProblem } from './crm-forecast.domain';
import type { TMarketplace } from '../../../shared/marketplace';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { ProductService } from '../../../database/services/product.service';
import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { FinanceForecastService } from '../../finance/finance-forecast.service';
import { financeToday } from '../../finance/finance-period';
import { FinanceService } from '../../finance/finance.service';
import { FORECAST_NO_JOURNAL, FORECAST_NO_SALES, forecastPlan } from '../../finance/forecast';
import { purchaseNeedsOf } from '../../finance/forecast-purchases';
import { MarketplaceRegistry } from '../../marketplaces/marketplace-registry.service';
import { availableBySku } from '../../marketplaces/marketplace-stocks';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { fbyStockUnavailableLine } from '../../yandex/fby/fby-message';
import { applyDiscounts, ratesOf } from '../../yandex/reports/profit';
import { reportErrorMessage } from '../../yandex/reports/report-message';
import { accountStores } from '../../yandex/stores/stores.domain';
import { CrmJobError, parseJobMarketplace, withoutIcon } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { byPurchaseKey, marketplaceAvailable, ymStocks } from '../jobs/crm-marketplace-stocks';

import {
  FORECAST_KIND,
  FORECAST_PARAMS_INVALID_TEXT,
  FORECAST_PURCHASES_KIND,
  parseBasisDays,
  parseCoverDays,
  toCrmForecast,
} from './crm-forecast.domain';

/**
 * Два kind-а «Прогнозов» (TASK-151), оба уровня аккаунта, под `forecast`
 * (она требует `finance` сама — `requires`).
 *
 * - `forecast:summary` — `FinanceForecastService.build`, только Postgres.
 * - `forecast:purchases` — по кнопке (решение `forecast_purchases_button`):
 *   скорость продаж из окна базы того же плана, остатки — по всем магазинам
 *   кабинета, по очереди (квоты Partner API — на токен). Только чтение. Сбой
 *   магазина — строка с причиной, а не ноль остатка.
 *
 * Площадка — экрана (`params.marketplace`, TASK-183): журнал и «к получению» —
 * её; остатки Ozon/WB — через реестр, артикул площадки приводится к ключу
 * журнала (артикул ЯМ карточки). ЯМ на экране Ozon не спрашивается. Площадка
 * эхом в ответе.
 */
@Injectable()
export class CrmForecastKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly forecasts: FinanceForecastService,
    private readonly finance: FinanceService,
    private readonly marketplaces: MarketplaceRegistry,
    private readonly purchasePrices: PurchasePriceService,
    private readonly products: ProductService,
  ) {}

  onModuleInit(): void {
    this.registry.register(FORECAST_KIND, {
      features: [FEATURE.FORECAST],
      scope: 'account',
      run: (context) => this.summary(context),
    });
    this.registry.register(FORECAST_PURCHASES_KIND, {
      features: [FEATURE.FORECAST],
      scope: 'account',
      run: (context) => this.purchases(context),
    });
  }

  async summary(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const basisDays = parseBasisDays(context.params);
    if (!basisDays) throw new CrmJobError(FORECAST_PARAMS_INVALID_TEXT);
    const marketplace = this.marketplaceOf(context);
    const { result } = await this.forecasts.build(
      context.telegramUserId,
      basisDays,
      now,
      marketplace,
    );
    return { data: { ...toCrmForecast(basisDays, financeToday(now), result), marketplace } };
  }

  async purchases(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const basisDays = parseBasisDays(context.params);
    const coverDays = parseCoverDays(context.params);
    if (!basisDays || !coverDays) throw new CrmJobError(FORECAST_PARAMS_INVALID_TEXT);
    const marketplace = this.marketplaceOf(context);

    const { telegramUserId } = context;
    const today = financeToday(now);
    const plan = forecastPlan(today, basisDays);
    const basis = await this.finance.build(telegramUserId, plan.basis, now, {
      flat: false,
      marketplace,
    });
    const empty = {
      marketplace,
      today,
      takenAt: now.toISOString(),
      coverDays,
      basisDays,
      totalUnits: 0,
      totalKopecks: 0,
      withoutCost: { skus: 0, units: 0 },
      stores: 0,
      problems: [],
      rows: null,
    };
    const missing = basis.months.find((month) => month.status === null);
    if (missing) {
      const month = `${missing.from.slice(5, 7)}.${missing.from.slice(0, 4)}`;
      return { data: { ...empty, reason: FORECAST_NO_JOURNAL(month) } };
    }

    const sold = new Map<string, number>();
    for (const sku of basis.pnl.skus.skus) sold.set(sku.sku, (sold.get(sku.sku) ?? 0) + sku.units);
    if (![...sold.values()].some((units) => units > 0)) {
      return { data: { ...empty, reason: FORECAST_NO_SALES(basisDays) } };
    }

    const problems: ICrmStoreProblem[] = [];
    const stock = new Map<string, number>();
    let anyStock = false;
    const stores = marketplace === 'ym' ? accountStores(context.store) : [];
    if (marketplace !== 'ym') {
      const found = await marketplaceAvailable(this.marketplaces, telegramUserId, marketplace, now);
      if (found.problem !== null) {
        problems.push({ storeName: MARKETPLACE_LABEL[marketplace], problem: found.problem });
      } else {
        anyStock = true;
        const cards = await this.products.findByJournalSkus(
          telegramUserId,
          marketplace,
          Object.keys(found.available),
        );
        for (const [sku, count] of Object.entries(byPurchaseKey(found.available, cards))) {
          if (count > 0) stock.set(sku, count);
        }
      }
    }
    for (const store of stores) {
      try {
        const levels = await ymStocks(this.marketplaces, store, now);
        const available = availableBySku(levels);
        if (!available) {
          problems.push({
            storeName: store.name ?? '',
            problem: withoutIcon(fbyStockUnavailableLine(levels.error)),
          });
          continue;
        }
        anyStock = true;
        for (const [sku, count] of Object.entries(available)) {
          if (count > 0) stock.set(sku, (stock.get(sku) ?? 0) + count);
        }
      } catch (error) {
        problems.push({ storeName: store.name ?? '', problem: reportErrorMessage(error) });
      }
    }

    const skus = [...sold.keys()];
    const [rows, found] = await Promise.all([
      this.purchasePrices.findBySkus(telegramUserId, skus),
      this.products.findByJournalSkus(telegramUserId, marketplace, skus),
    ]);
    const names = new Map<string, string>();
    for (const [sku, product] of found) names.set(sku, product.name);
    const needs = purchaseNeedsOf(
      sold,
      anyStock ? stock : null,
      applyDiscounts(rows, ratesOf(context.store ?? {})),
      basisDays,
      coverDays,
    );

    const data: ICrmForecastPurchases = {
      ...needs,
      marketplace,
      today,
      takenAt: now.toISOString(),
      rows: needs.rows.map((row) => ({ ...row, name: names.get(row.sku) ?? null })),
      reason: null,
      stores: marketplace === 'ym' ? stores.length : 1,
      problems,
    };
    return { data };
  }

  /** Площадка экрана; мусор и закрытая фича площадки — отказ задачи. */
  private marketplaceOf(context: ICrmJobContext): TMarketplace {
    const parsed = parseJobMarketplace(context.params, context.features ?? {});
    if ('error' in parsed) throw new CrmJobError(parsed.text);
    return parsed.marketplace;
  }
}
