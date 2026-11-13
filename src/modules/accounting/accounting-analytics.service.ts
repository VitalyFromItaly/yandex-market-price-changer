import type {
  IAccountingAnalyticsSummary,
  TAnalyticsAvailability,
} from './accounting-analytics.domain';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { YandexMarketDocument } from '../../database/schemas/yandex-market.schema';
import type { IFinancePeriod } from '../finance/finance-period';

import { Injectable } from '@nestjs/common';

import {
  ANALYTICS_NOT_CONNECTED_REASON,
  ANALYTICS_NOT_LOADED_REASON,
  ANALYTICS_NO_STORE_REASON,
  analyticsOf,
} from './accounting-analytics.domain';
import { AccountingOrderCardService } from './accounting-order-card.service';
import { AccountingService } from './accounting.service';

type TFeatures = Readonly<Record<string, boolean>>;

/** Порядок площадок в сравнении — все три, недоступные с причиной. */
const ANALYTICS_MARKETPLACES: readonly TFinanceMarketplace[] = ['ym', 'ozon', 'wb'];

export interface IAccountingAnalytics extends IAccountingAnalyticsSummary {
  period: IFinancePeriod;
}

/**
 * Аналитика «Финучёта» (TASK-230): заказы, оформленные в периоде, магазина из URL —
 * те же карточки, что базис «продажа» панели (`ordersCreatedIn`). Площадка
 * участвует, только если она подключена с открытой фичей (`marketplacesOf`),
 * её реестр хоть раз загрузился (`syncStatus`) и — для ЯМ — магазин выбран;
 * иначе в сравнении стоит `insufficientData` с причиной.
 */
@Injectable()
export class AccountingAnalyticsService {
  constructor(
    private readonly accounting: AccountingService,
    private readonly orderCards: AccountingOrderCardService,
  ) {}

  async period(
    telegramUserId: string,
    features: TFeatures,
    store: YandexMarketDocument | null,
    period: IFinancePeriod,
    now: Date = new Date(),
  ): Promise<IAccountingAnalytics> {
    const enabled = await this.accounting.marketplacesOf(telegramUserId, features);
    const sync = await this.accounting.syncStatus(telegramUserId, features, now);
    const loaded = new Set(
      sync.marketplaces.filter((m) => m.lastSuccessAt).map((m) => m.marketplace),
    );

    const availability = {} as TAnalyticsAvailability;
    for (const marketplace of ANALYTICS_MARKETPLACES) {
      let reason: string | null = null;
      if (!enabled.includes(marketplace)) reason = ANALYTICS_NOT_CONNECTED_REASON;
      else if (marketplace === 'ym' && !store?.campaign_id) reason = ANALYTICS_NO_STORE_REASON;
      else if (!loaded.has(marketplace)) reason = ANALYTICS_NOT_LOADED_REASON;
      availability[marketplace] = reason;
    }

    const anyOpen = ANALYTICS_MARKETPLACES.some((m) => availability[m] === null);
    const orders = anyOpen
      ? await this.orderCards.ordersCreatedIn(telegramUserId, features, store, period, null, now)
      : [];
    return { period, ...analyticsOf(orders, availability, period) };
  }
}
