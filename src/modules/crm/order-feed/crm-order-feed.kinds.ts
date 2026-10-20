import type {
  ICrmOrderFeedMarketplace,
  ICrmOrderFeedProblem,
  TCrmOrderFeedState,
} from './crm-order-feed.domain';
import type { TMarketplace } from '../../../shared/marketplace';
import type { IOrderFeed } from '../../finance/order-feed';
import type { IMarketplaceOrder } from '../../marketplaces/marketplace-adapter';
import type { IReportPeriod } from '../../yandex/reports/report-period';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { MARKETPLACES, MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { OrderFeedService } from '../../finance/order-feed.service';
import { MarketplaceNotConnectedError } from '../../marketplaces/marketplace-adapter';
import { MarketplaceRegistry } from '../../marketplaces/marketplace-registry.service';
import { ymMarketplaceOrder } from '../../marketplaces/ym-orders';
import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { OrderReportsService } from '../../yandex/reports/order-reports.service';
import { reportErrorMessage } from '../../yandex/reports/report-message';
import { placementOfCampaign } from '../../yandex/stocks/placement';
import { accountStores } from '../../yandex/stores/stores.domain';
import { isFinanceMarketplaceOpen } from '../finance/crm-finance.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { parsePeriodParams } from '../jobs/crm-period.domain';

import {
  ORDER_FEED_ACT_NOTE,
  ORDER_FEED_KIND,
  ORDER_FEED_NOT_CONNECTED_TEXT,
  ORDER_FEED_OZON_RETURNS_NOTE,
  ORDER_FEED_WB_NOTE,
  toCrmOrderFeed,
} from './crm-order-feed.domain';

/** Заказы площадки, собранные для ленты, и её состояние. */
interface ICollected {
  orders: IMarketplaceOrder[];
  state: TCrmOrderFeedState;
}

/**
 * «Лента заказов» (TASK-144) — kind уровня аккаунта под `order_feed` (она
 * требует `finance` сама). Только чтение. Заказы: ЯМ — по каждому магазину
 * кабинета (`collectPlacedOrders`, как «Обзор»: адаптер ЯМ знает один активный
 * магазин), Ozon/WB — возможность `orders` реестра под своими фичами. Прибыль —
 * `OrderFeedService` по журналу каждой площадки отдельно. Магазины и площадки
 * — по очереди (квоты на токен), сбой каждой — строка с причиной, а не пустота.
 */
@Injectable()
export class CrmOrderFeedKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly marketplaces: MarketplaceRegistry,
    private readonly reports: OrderReportsService,
    private readonly orderFeed: OrderFeedService,
  ) {}

  onModuleInit(): void {
    this.registry.register(ORDER_FEED_KIND, {
      features: [FEATURE.ORDER_FEED],
      scope: 'account',
      run: (context) => this.list(context),
    });
  }

  async list(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const period = parsePeriodParams(context.params);
    const features = context.features ?? {};
    const problems: ICrmOrderFeedProblem[] = [];
    const notes: string[] = [];

    const open = MARKETPLACES.filter(
      (marketplace) =>
        isFinanceMarketplaceOpen(features, marketplace) &&
        this.marketplaces.capability(marketplace, 'orders') !== null,
    );

    const states: ICrmOrderFeedMarketplace[] = [];
    const feeds: IOrderFeed[] = [];
    for (const marketplace of open) {
      const collected =
        marketplace === 'ym'
          ? await this.ymOrders(context, period, now, problems)
          : await this.marketplaceOrders(context, marketplace, period, now, problems);
      states.push({ marketplace, label: MARKETPLACE_LABEL[marketplace], state: collected.state });
      if (collected.state !== 'ok') continue;
      try {
        feeds.push(
          await this.orderFeed.list(context.telegramUserId, marketplace, collected.orders),
        );
      } catch (error) {
        problems.push({
          marketplace,
          storeName: null,
          problem: `Журнал ${MARKETPLACE_LABEL[marketplace]} не прочитан: ${reportErrorMessage(error)}`,
        });
      }
    }

    if (open.includes('ym')) notes.push(ORDER_FEED_ACT_NOTE);
    if (open.includes('ozon')) notes.push(ORDER_FEED_OZON_RETURNS_NOTE);
    if (open.includes('wb')) notes.push(ORDER_FEED_WB_NOTE);

    return {
      data: toCrmOrderFeed({ period, now, marketplaces: states, feeds, problems, notes }),
    };
  }

  /** ЯМ: оформленные за период заказы всех магазинов кабинета, с отменёнными. */
  private async ymOrders(
    context: ICrmJobContext,
    period: IReportPeriod,
    now: Date,
    problems: ICrmOrderFeedProblem[],
  ): Promise<ICollected> {
    const deepHistory = isFeatureEnabled(context.features ?? {}, FEATURE.DEEP_HISTORY);
    const orders: IMarketplaceOrder[] = [];
    let failed = 0;
    const stores = accountStores(context.store);
    for (const store of stores) {
      try {
        const placed = await this.reports.collectPlacedOrders(store, period, now, {
          deepHistory,
        });
        const scheme = placementOfCampaign(store.stores, store.campaign_id) ?? null;
        for (const order of [...placed.orders, ...placed.cancelled]) {
          orders.push(ymMarketplaceOrder(order, scheme));
        }
      } catch (error) {
        failed += 1;
        problems.push({
          marketplace: 'ym',
          storeName: store.name ?? '',
          problem: reportErrorMessage(error),
        });
      }
    }
    return { orders, state: stores.length > 0 && failed === stores.length ? 'failed' : 'ok' };
  }

  /** Ozon/WB: заказы периода через реестр. */
  private async marketplaceOrders(
    context: ICrmJobContext,
    marketplace: TMarketplace,
    period: IReportPeriod,
    now: Date,
    problems: ICrmOrderFeedProblem[],
  ): Promise<ICollected> {
    const { telegramUserId } = context;
    try {
      const { orders, cancelled } = await this.marketplaces
        .require(marketplace, 'orders', telegramUserId)
        .listOrders({ telegramUserId, marketplace }, period, now);
      return { orders: [...orders, ...cancelled], state: 'ok' };
    } catch (error) {
      if (error instanceof MarketplaceNotConnectedError) {
        problems.push({
          marketplace,
          storeName: null,
          problem: ORDER_FEED_NOT_CONNECTED_TEXT(marketplace),
        });
        return { orders: [], state: 'not-connected' };
      }
      problems.push({ marketplace, storeName: null, problem: reportErrorMessage(error) });
      return { orders: [], state: 'failed' };
    }
  }
}
