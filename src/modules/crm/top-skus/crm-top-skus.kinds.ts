import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { ProfitService } from '../../yandex/reports/profit.service';
import { PERIOD } from '../../yandex/reports/report-period';
import { topSkusOf } from '../../yandex/top-skus/top-skus.domain';
import { YandexDateRangeError } from '../../yandex/yandex-date-window';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { parsePeriodParams } from '../jobs/crm-period.domain';

import { TOP_SKUS_KIND, toCrmTopSkusView } from './crm-top-skus.domain';

/**
 * «🏆 Топ товаров» фоновой задачей CRM (`top-skus:summary`, магазина — как «Прибыль»).
 *
 * Тот же `ProfitService.build`, что TopSkusReportProcessor бота: числа совпадают по
 * построению. Своего флага нет — экран под `report_profit`; `deep_history` едет снимком features.
 * Периоды — бота плюс `prevmonth` и свой диапазон `range`.
 */
@Injectable()
export class CrmTopSkusKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly profit: ProfitService,
  ) {}

  onModuleInit(): void {
    this.registry.register(TOP_SKUS_KIND, {
      features: [FEATURE.REPORT_PROFIT],
      run: (context) => this.summary(context),
    });
  }

  async summary(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const period = parsePeriodParams(context.params, [PERIOD.PREV_MONTH, PERIOD.RANGE]);
    try {
      const report = await this.profit.build(context.store, period, now, {
        deepHistory: isFeatureEnabled(context.features, FEATURE.DEEP_HISTORY),
        places: true,
      });
      return { data: toCrmTopSkusView(topSkusOf(report), now) };
    } catch (error) {
      // Период глубже 30 дней без deep_history или длиннее года — ожидаемый отказ.
      if (error instanceof YandexDateRangeError) throw new CrmJobError(error.userMessage);
      throw error;
    }
  }
}
