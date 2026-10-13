import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { StockLevelsService } from '../../yandex/stocks/stock-levels.service';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

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
    private readonly levels: StockLevelsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(STOCKS_JOB_KIND, {
      features: [FEATURE.REPORT_PROFIT],
      run: (context) => this.run(context),
    });
  }

  async run(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    return { data: toCrmStocksView(await this.levels.levels(context.store, now)) };
  }
}
