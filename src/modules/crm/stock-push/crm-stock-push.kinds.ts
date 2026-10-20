import type { TMarketplace } from '../../../shared/marketplace';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { MARKETPLACES } from '../../../shared/marketplace';
import { STOCK_PUSH_WRITE_FEATURE, StockPushService } from '../../stock-push/stock-push.service';
import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import { STOCK_PUSH_KIND, toCrmStockPush } from './crm-stock-push.domain';

/**
 * План «Передачи остатков» (TASK-143) — kind уровня аккаунта под `stock_push`.
 * Только чтение: заказы и остатки площадок, свой склад из прайса. Запись —
 * отдельным маршрутом `apply`, через очередь file-processing.
 */
@Injectable()
export class CrmStockPushKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly stockPush: StockPushService,
  ) {}

  onModuleInit(): void {
    this.registry.register(STOCK_PUSH_KIND, {
      features: [FEATURE.STOCK_PUSH],
      scope: 'account',
      run: (context) => this.plan(context),
    });
  }

  async plan(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const features = context.features ?? {};
    const result = await this.stockPush.plan(context.telegramUserId, features, now);
    return {
      data: toCrmStockPush(result, {
        now,
        writeOpen: Object.fromEntries(
          MARKETPLACES.map((marketplace) => [
            marketplace,
            isFeatureEnabled(features, STOCK_PUSH_WRITE_FEATURE[marketplace]),
          ]),
        ) as Record<TMarketplace, boolean>,
      }),
    };
  }
}
