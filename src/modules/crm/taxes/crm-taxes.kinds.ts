import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FinanceTaxYearService } from '../../finance/finance-tax-year.service';
import { isTaxYearInRange } from '../../finance/tax-year.domain';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { moscowDay } from '../../yandex/reports/moscow-day';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import { TAX_YEAR_INVALID_TEXT, TAX_YEAR_KIND, toCrmTaxYear } from './crm-taxes.domain';

/**
 * Kind вкладки «Год» (TASK-146), уровня аккаунта. До четырёх `FinanceService.build`
 * с начала года — секунды на журнале за год, поэтому фоновая задача, а не GET.
 * `tax_year` требует `taxes` и `finance` сама (`requires`).
 */
@Injectable()
export class CrmTaxesKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly taxYear: FinanceTaxYearService,
  ) {}

  onModuleInit(): void {
    this.registry.register(TAX_YEAR_KIND, {
      features: [FEATURE.TAX_YEAR],
      scope: 'account',
      run: (context) => this.year(context),
    });
  }

  async year(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const year = Number(context.params?.year);
    if (!isTaxYearInRange(year, moscowDay(now).year)) throw new CrmJobError(TAX_YEAR_INVALID_TEXT);
    return { data: toCrmTaxYear(await this.taxYear.build(context.telegramUserId, year, now)) };
  }
}
