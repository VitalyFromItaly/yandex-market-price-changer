import type { ITaxReduction, ITaxYearParamsRow } from './finance-tax-year-data.service';
import type { ITaxYear } from './tax-year';
import type { ITaxSettings } from './tax.domain';

import { Injectable } from '@nestjs/common';

import { FinancePurchaseRepository } from '../../database/postgres/repositories/finance-purchase.repository';

import { financeToday } from './finance-period';
import { FinanceTaxYearDataService } from './finance-tax-year-data.service';
import { FinanceTaxService } from './finance-tax.service';
import { FinanceService } from './finance.service';
import { reportingPeriodsOf, taxYearOf } from './tax-year';

export interface ITaxYearReport {
  taxYear: ITaxYear;
  settings: ITaxSettings;
  taxIsDefault: boolean;
  hasStaff: boolean;
  /** null — строки года в таблице параметров нет. */
  params: ITaxYearParamsRow | null;
  reductions: ITaxReduction[];
}

/**
 * Налоговый модуль ИП за год (TASK-146). Своей формулы нет: доход и налог
 * каждого отчётного периода — `FinanceService.build` с 1 января по конец
 * периода, т.е. тот же `taxOf` на тех же строках, что «Финансы» за этот
 * период. Расхождение «Налоги ≠ Финансы» поэтому невозможно по построению.
 *
 * Периоды строятся по очереди, а не `Promise.all`: каждый — запрос журнала с
 * начала года, и четыре таких разом на пул в 10 соединений — лишняя нагрузка
 * ради секунд в фоновой задаче.
 */
@Injectable()
export class FinanceTaxYearService {
  constructor(
    private readonly finance: FinanceService,
    private readonly taxes: FinanceTaxService,
    private readonly data: FinanceTaxYearDataService,
    private readonly purchases: FinancePurchaseRepository,
  ) {}

  async build(
    telegramUserId: string,
    year: number,
    now: Date = new Date(),
  ): Promise<ITaxYearReport> {
    const today = financeToday(now);
    const yearFrom = `${year}-01-01`;
    const yearTo = `${year}-12-31`;
    const [snapshot, params, reductions, payments, reconciliations] = await Promise.all([
      this.taxes.snapshot(telegramUserId),
      this.data.params(year),
      this.data.reductionsBetween(telegramUserId, yearFrom, yearTo),
      this.purchases.taxPaymentsBetween(telegramUserId, yearFrom, yearTo),
      this.data.reconciliations(telegramUserId, year),
    ]);

    const periods = [];
    for (const range of reportingPeriodsOf(year, today)) {
      const report = await this.finance.build(telegramUserId, range, now, { flat: false });
      periods.push({ ...range, tax: report.pnl.tax });
    }

    const taxYear = taxYearOf({
      year,
      today,
      settings: snapshot.settings,
      hasStaff: snapshot.hasStaff,
      params,
      periods,
      reductions,
      payments: payments.map((p) => ({ paidDay: p.paidDay, amountKopecks: p.amountKopecks })),
      reconciliations,
    });
    return {
      taxYear,
      settings: snapshot.settings,
      taxIsDefault: snapshot.isDefault,
      hasStaff: snapshot.hasStaff,
      params,
      reductions,
    };
  }
}
