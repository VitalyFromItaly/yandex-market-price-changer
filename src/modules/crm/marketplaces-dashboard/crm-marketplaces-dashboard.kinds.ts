import type { TFinanceMarketplace } from '../../../database/postgres/finance.schema';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../../database/services/marketplace-connection.service';
import { YandexMarketService } from '../../../database/services/yandex-market.service';
import { FinanceService } from '../../finance/finance.service';
import { connectedOpenMarketplaces } from '../../marketplaces/marketplace-connections.domain';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { MARKETPLACE_COMPARE_RANGE_INVALID_TEXT } from '../marketplace-compare/crm-marketplace-compare.domain';
import { parseOverviewRanges } from '../overview/crm-overview.domain';

import {
  DASHBOARD_NEEDS_SECOND_TEXT,
  MARKETPLACES_DASHBOARD_KIND,
  isDashboardEnough,
  toCrmMarketplacesDashboard,
} from './crm-marketplaces-dashboard.domain';

/**
 * Kind дашборда «Площадки» (TASK-191), уровня аккаунта.
 *
 * Площадки — подключённые и открытые (`connectedOpenMarketplaces`, то же правило,
 * что прячет раздел в `/auth/me`); меньше двух — отказ с понятным текстом, а не
 * дашборд из одной колонки. Дальше — те же два `FinanceService.compare`, что у
 * «Сравнения площадок». Фича одна: `marketplaces_dashboard` требует `finance` сама.
 */
@Injectable()
export class CrmMarketplacesDashboardKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly finance: FinanceService,
    private readonly stores: YandexMarketService,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  onModuleInit(): void {
    this.registry.register(MARKETPLACES_DASHBOARD_KIND, {
      features: [FEATURE.MARKETPLACES_DASHBOARD],
      scope: 'account',
      run: (context) => this.summary(context),
    });
  }

  async summary(context: ICrmJobContext): Promise<ICrmJobOutput> {
    const ranges = parseOverviewRanges(context.params);
    if (!ranges) throw new CrmJobError(MARKETPLACE_COMPARE_RANGE_INVALID_TEXT);

    const { telegramUserId } = context;
    const [store, rows] = await Promise.all([
      this.stores.findByTelegramUser(telegramUserId),
      this.connections.findForUser(telegramUserId),
    ]);
    // Финжурнал есть у всех трёх площадок: TMarketplace и TFinanceMarketplace совпадают.
    const live: TFinanceMarketplace[] = connectedOpenMarketplaces(
      store,
      rows,
      context.features ?? {},
    );
    if (!isDashboardEnough(live)) throw new CrmJobError(DASHBOARD_NEEDS_SECOND_TEXT);

    const [current, previous] = await Promise.all([
      this.finance.compare(telegramUserId, ranges.current, live),
      this.finance.compare(telegramUserId, ranges.previous, live),
    ]);
    return {
      data: toCrmMarketplacesDashboard(ranges.current, ranges.previous, live, current, previous),
    };
  }
}
