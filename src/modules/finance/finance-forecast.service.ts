import type { IFinancePeriod } from './finance-period';
import type { TForecastBasisDays, TForecastResult } from './forecast';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';

import { Injectable } from '@nestjs/common';

import { FINANCE_ARTICLE_KEYS } from './finance-articles';
import { FinanceCashflowService } from './finance-cashflow.service';
import { financeToday } from './finance-period';
import { FinanceTaxService } from './finance-tax.service';
import { FinanceService } from './finance.service';
import { forecastOf, forecastPlan } from './forecast';

/**
 * Прогноз (TASK-151) — одна дверь для экрана CRM и ИИ-инструмента `getForecast`,
 * поэтому числа на экране и в ответе чата совпадают по построению.
 *
 * Все периоды плана — `FinanceService.build` без плоской оценки (`flat: false`:
 * она — Маркет и десятки секунд, прогнозу не нужна), «к получению» — тот же
 * `receivable`, что у ДДС. Формулы — чистая `forecastOf`. Площадка — экрана
 * (TASK-183): журнал и «к получению» только её; ИИ-инструмент зовёт без неё — ЯМ.
 */
export interface IForecastBuild {
  result: TForecastResult;
  basis: IFinancePeriod;
  /**
   * id операций окна базы — источник для ИИ («Операции (N)»). В ответ экрана не
   * идут: на 56 днях это тысячи строк.
   */
  basisOperationIds: string[];
}

@Injectable()
export class FinanceForecastService {
  constructor(
    private readonly finance: FinanceService,
    private readonly cashflow: FinanceCashflowService,
    private readonly taxes: FinanceTaxService,
  ) {}

  async build(
    telegramUserId: string,
    basisDays: TForecastBasisDays,
    now: Date = new Date(),
    marketplace: TFinanceMarketplace = 'ym',
  ): Promise<IForecastBuild> {
    const plan = forecastPlan(financeToday(now), basisDays);
    const build = (period: { from: string; to: string }) =>
      this.finance.build(telegramUserId, period, now, { flat: false, marketplace });

    const [basis, monthFact, yearFact, receivable, taxSnapshot, ...marginMonths] =
      await Promise.all([
        build(plan.basis),
        plan.monthFact ? build(plan.monthFact) : Promise.resolve(null),
        plan.yearFact ? build(plan.yearFact) : Promise.resolve(null),
        this.cashflow.receivable(telegramUserId, now, marketplace),
        this.taxes.snapshot(telegramUserId),
        ...plan.marginMonths.map(build),
      ]);

    const result = forecastOf({
      plan,
      basis,
      monthFact,
      yearFact,
      marginMonths,
      receivable,
      taxIsDefault: basis.taxIsDefault,
      tax: {
        regime: taxSnapshot.settings.regime,
        rateBasisPoints: taxSnapshot.settings.rateBasisPoints,
      },
    });
    const basisOperationIds = FINANCE_ARTICLE_KEYS.flatMap(
      (key) => basis.pnl.byArticle[key].operationIds,
    );
    return { result, basis: plan.basis, basisOperationIds };
  }
}
