import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FINANCE_MARKETPLACES } from '../../../database/postgres/finance.schema';
import { FinanceService } from '../../finance/finance.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { isFinanceMarketplaceOpen } from '../finance/crm-finance.domain';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { parseOverviewRanges } from '../overview/crm-overview.domain';

import {
  MARKETPLACE_COMPARE_KIND,
  MARKETPLACE_COMPARE_RANGE_INVALID_TEXT,
  toCrmMarketplaceCompare,
} from './crm-marketplace-compare.domain';

/**
 * Kind «Сравнения площадок» (TASK-137), уровня аккаунта.
 *
 * Текущий и прошлый период (`from/to`, `prevFrom/prevTo`, разбор общий с
 * «Обзором») — два `FinanceService.compare` по открытым площадкам. Площадка с
 * закрытой фичей (`ozon`/`wb` из снимка задачи) не читается вовсе — её колонка
 * приходит `closed`. Фича одна: `marketplace_compare` требует `finance` сама.
 */
@Injectable()
export class CrmMarketplaceCompareKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly finance: FinanceService,
  ) {}

  onModuleInit(): void {
    this.registry.register(MARKETPLACE_COMPARE_KIND, {
      features: [FEATURE.MARKETPLACE_COMPARE],
      scope: 'account',
      run: (context) => this.summary(context),
    });
  }

  async summary(context: ICrmJobContext): Promise<ICrmJobOutput> {
    const ranges = parseOverviewRanges(context.params);
    if (!ranges) throw new CrmJobError(MARKETPLACE_COMPARE_RANGE_INVALID_TEXT);

    const { telegramUserId } = context;
    const open = FINANCE_MARKETPLACES.filter((marketplace) =>
      isFinanceMarketplaceOpen(context.features ?? {}, marketplace),
    );
    // По очереди, а не `Promise.all`: пул Postgres — 10 соединений (README finance).
    const current = await this.finance.compare(telegramUserId, ranges.current, open);
    const previous = await this.finance.compare(telegramUserId, ranges.previous, open);
    return {
      data: toCrmMarketplaceCompare(
        ranges.current,
        ranges.previous,
        FINANCE_MARKETPLACES,
        current,
        previous,
      ),
    };
  }
}
