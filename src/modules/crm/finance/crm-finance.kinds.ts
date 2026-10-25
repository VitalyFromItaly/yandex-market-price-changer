import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { FinanceService } from '../../finance/finance.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { CrmJobError, parseJobMarketplace } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import {
  FINANCE_PERIOD_INVALID_TEXT,
  FINANCE_PNL_KIND,
  parseFinanceRangeParams,
  toCrmPnlView,
} from './crm-finance.domain';

export const FINANCE_MONTH_INVALID_TEXT = 'Месяц указан неверно — выберите его из списка.';

/**
 * P&L месяца как фоновая задача CRM (`finance:pnl`, уровня аккаунта).
 *
 * Фоновая, потому что непроверенный текущий месяц строит рядом плоскую оценку
 * «Прибыли» — это запросы к Маркету на десятки секунд. Уровня аккаунта, потому
 * что журнал бизнесовый и статусы месяцев — на продавца, а не на магазин:
 * магазин в задачу не едет, замок — на продавца (решение `finance_crm_month_picker`).
 *
 * Период — месяц `{month}` или произвольный `{from,to}` (ссылка с «Обзора»,
 * решение `finance_pnl_range`): `FinanceService.build` принимает любой диапазон.
 *
 * Площадка — `marketplace` (TASK-137, `finance_pnl_marketplace_param`), умолчание ЯМ:
 * ячейка «Сравнения площадок» раскрывается в «Прибыль» своей площадки. Ozon/WB —
 * только при открытой фиче площадки: kind знает одну `finance`, площадку — снимок.
 */
@Injectable()
export class CrmFinanceKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly finance: FinanceService,
  ) {}

  onModuleInit(): void {
    this.registry.register(FINANCE_PNL_KIND, {
      features: [FEATURE.FINANCE],
      scope: 'account',
      run: (context) => this.run(context),
    });
  }

  async run(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const request = parseFinanceRangeParams(context.params);
    if (!request) {
      throw new CrmJobError(
        context.params.month === undefined
          ? FINANCE_PERIOD_INVALID_TEXT
          : FINANCE_MONTH_INVALID_TEXT,
      );
    }
    const parsed = parseJobMarketplace(context.params, context.features ?? {});
    if ('error' in parsed) throw new CrmJobError(parsed.text);
    const { marketplace } = parsed;
    const report = await this.finance.build(context.telegramUserId, request.period, now, {
      marketplace,
    });
    return { data: toCrmPnlView(request.month, report, marketplace) };
  }
}
