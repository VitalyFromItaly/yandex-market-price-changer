import type { ICrmReturnsProblem } from './crm-returns-analytics.domain';
import type { IReturnsAnalytics } from '../../finance/returns-analytics';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FINANCE_MARKETPLACES } from '../../../database/postgres/finance.schema';
import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { ReturnsAnalyticsService } from '../../finance/returns-analytics.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { reportErrorMessage } from '../../yandex/reports/report-message';
import { isFinanceMarketplaceOpen, parseDayRange } from '../finance/crm-finance.domain';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import {
  RETURNS_ANALYTICS_KIND,
  RETURNS_ANALYTICS_RANGE_INVALID_TEXT,
  toCrmReturnsAnalytics,
} from './crm-returns-analytics.domain';

/**
 * Kind «Аналитики возвратов» (TASK-145), уровня аккаунта.
 *
 * Период — `from/to` от браузера (`parseDayRange`, как у «Финансов»). Журнал
 * каждой площадки, открытой продавцу (`isFinanceMarketplaceOpen`: ЯМ — фичей
 * `finance` через `requires`, Ozon/WB — своими фичами), читается отдельно;
 * сбой одной площадки — строка проблемы, остальные показываются.
 */
@Injectable()
export class CrmReturnsAnalyticsKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly returns: ReturnsAnalyticsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(RETURNS_ANALYTICS_KIND, {
      features: [FEATURE.RETURNS_ANALYTICS],
      scope: 'account',
      run: (context) => this.summary(context),
    });
  }

  async summary(context: ICrmJobContext): Promise<ICrmJobOutput> {
    const period = parseDayRange(context.params.from, context.params.to);
    if (!period) throw new CrmJobError(RETURNS_ANALYTICS_RANGE_INVALID_TEXT);

    const features = context.features ?? {};
    const reports: IReturnsAnalytics[] = [];
    const problems: ICrmReturnsProblem[] = [];
    for (const marketplace of FINANCE_MARKETPLACES) {
      if (!isFinanceMarketplaceOpen(features, marketplace)) continue;
      try {
        reports.push(await this.returns.build(context.telegramUserId, marketplace, period));
      } catch (error) {
        problems.push({
          marketplace,
          problem: `Журнал ${MARKETPLACE_LABEL[marketplace]} не прочитан: ${reportErrorMessage(error)}`,
        });
      }
    }

    return { data: toCrmReturnsAnalytics({ period, reports, problems }) };
  }
}
