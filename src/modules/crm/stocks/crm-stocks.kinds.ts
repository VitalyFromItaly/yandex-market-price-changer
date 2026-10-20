import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { MarketplaceRegistry } from '../../marketplaces/marketplace-registry.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { ymStocks } from '../jobs/crm-marketplace-stocks';

import { STOCKS_JOB_KIND, toCrmStocksView } from './crm-stocks.domain';

/**
 * Kind «остатки по товарам» — колонка остатка в «Топе товаров» и блок «На
 * исходе» главной. Под `report_profit`: без топа эти числа не показываются.
 * Срез «сейчас», параметров нет.
 */
@Injectable()
export class CrmStocksKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly marketplaces: MarketplaceRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(STOCKS_JOB_KIND, {
      features: [FEATURE.REPORT_PROFIT],
      run: (context) => this.run(context),
    });
  }

  async run(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    // Через реестр площадок (TASK-162): магазин задачи — по его кампании,
    // адаптер перечитывает и сужает документ сам, тем же `scopeStore`.
    const levels = await ymStocks(this.marketplaces, context.store, now);
    return { data: toCrmStocksView(levels) };
  }
}
