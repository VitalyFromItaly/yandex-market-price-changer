import type { ICrmReturnsProblem } from './crm-returns-analytics.domain';
import type { IReturnsAnalytics } from '../../finance/returns-analytics';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { MARKETPLACE_LABEL } from '../../../shared/marketplace';
import { ReturnsAnalyticsService } from '../../finance/returns-analytics.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { reportErrorMessage } from '../../yandex/reports/report-message';
import { parseDayRange } from '../finance/crm-finance.domain';
import { CrmJobError, parseJobMarketplace } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import {
  RETURNS_ANALYTICS_KIND,
  RETURNS_ANALYTICS_RANGE_INVALID_TEXT,
  toCrmReturnsAnalytics,
} from './crm-returns-analytics.domain';

/**
 * Kind «Аналитики возвратов» (TASK-145), уровня аккаунта.
 *
 * Период — `from/to` от браузера (`parseDayRange`, как у «Финансов»). Площадка —
 * экрана (`params.marketplace`, TASK-182; закрытая — отказ): журнал одной
 * площадки, сбой чтения — строка проблемы.
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

    const parsed = parseJobMarketplace(context.params, context.features ?? {});
    if ('error' in parsed) throw new CrmJobError(parsed.text);
    const { marketplace } = parsed;

    const reports: IReturnsAnalytics[] = [];
    const problems: ICrmReturnsProblem[] = [];
    try {
      reports.push(await this.returns.build(context.telegramUserId, marketplace, period));
    } catch (error) {
      problems.push({
        marketplace,
        problem: `Журнал ${MARKETPLACE_LABEL[marketplace]} не прочитан: ${reportErrorMessage(error)}`,
      });
    }

    return { data: toCrmReturnsAnalytics({ period, marketplace, reports, problems }) };
  }
}
