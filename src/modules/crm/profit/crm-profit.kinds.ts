import type { TCrmProfitReport } from './crm-profit.domain';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FinanceService } from '../../finance/finance.service';
import {
  FEATURE,
  REPORT_TO_FEATURE,
  isFeatureEnabled,
  isPrevMonthOpen,
} from '../../telegram/bots/shared/features.domain';
import { ProfitService } from '../../yandex/reports/profit.service';
import { PERIOD } from '../../yandex/reports/report-period';
import { REPORT } from '../../yandex/reports/report-status-map';
import { YandexDateRangeError } from '../../yandex/yandex-date-window';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { parsePeriodParams } from '../jobs/crm-period.domain';

import {
  CRM_PROFIT_REPORTS,
  profitJobKind,
  toCrmProfitView,
  toCrmTariffView,
} from './crm-profit.domain';

/**
 * «Прибыль» и «Калькулятор» как фоновые задачи CRM (`profit:<report>`).
 *
 * `run` зовёт тот же `ProfitService`, что процессоры бота, — числа совпадают
 * с ботом по построению. Фичу вкладки проверяет `CrmJwtGuard.assertFeatures`
 * при постановке; tariff_calc (строка калькулятора внутри «Прибыли») и
 * deep_history — модификаторы, они едут снимком в контексте. UserAccess здесь
 * не читается: у админа записи нет, и перепроверка по default-off фиче отбила
 * бы именно его (довод profit-report.processor).
 */
@Injectable()
export class CrmProfitKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly profit: ProfitService,
    private readonly finance: FinanceService,
  ) {}

  onModuleInit(): void {
    for (const key of CRM_PROFIT_REPORTS) {
      this.registry.register(profitJobKind(key), {
        features: [REPORT_TO_FEATURE[key]],
        run: (context) => this.run(key, context),
      });
    }
  }

  async run(
    key: TCrmProfitReport,
    context: ICrmJobContext,
    now: Date = new Date(),
  ): Promise<ICrmJobOutput> {
    // «Прошлый месяц» — только «Прибыли» и только при открытых фичах
    // (isPrevMonthOpen, одно правило с кнопкой бота); иначе — отказ разбора.
    const period = parsePeriodParams(
      context.params,
      key === REPORT.PROFIT && isPrevMonthOpen(context.features) ? [PERIOD.PREV_MONTH] : [],
    );
    const deepHistory = isFeatureEnabled(context.features, FEATURE.DEEP_HISTORY);

    try {
      if (key === REPORT.TARIFF_CALC) {
        const report = await this.profit.buildTariffReport(context.store, period, now, {
          deepHistory,
        });
        return { data: toCrmTariffView(report, now) };
      }

      // Фактическая чистая — тем же actualNet, что кнопка и рассылка бота.
      const [report, actual] = await Promise.all([
        this.profit.build(context.store, period, now, {
          tariffEstimate: isFeatureEnabled(context.features, FEATURE.TARIFF_CALC),
          deepHistory,
        }),
        isFeatureEnabled(context.features, FEATURE.PROFIT_ACTUAL)
          ? this.finance.actualNet(context.telegramUserId, period, now)
          : undefined,
      ]);
      return { data: toCrmProfitView(report, now, actual) };
    } catch (error) {
      // Период глубже 30 дней без deep_history — ожидаемый отказ с готовым
      // текстом, а не сбой: админов не будим.
      if (error instanceof YandexDateRangeError) throw new CrmJobError(error.userMessage);
      throw error;
    }
  }
}
