import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { ProductService } from '../../../database/services/product.service';
import { FinanceService } from '../../finance/finance.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { CrmJobError, parseJobMarketplace } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { parseOverviewRanges } from '../overview/crm-overview.domain';

import {
  UNIT_ECONOMICS_KIND,
  UNIT_ECONOMICS_RANGE_INVALID_TEXT,
  toCrmUnitEconomics,
} from './crm-unit-economics.domain';

/**
 * Kind «Unit-экономики» (TASK-138), уровня аккаунта.
 *
 * Текущий и прошлый период — два вызова `FinanceService.build` без плоской
 * оценки, как у «Обзора»; периоды присылает браузер (`from/to`, `prevFrom/prevTo`),
 * разбор — общий с «Обзором» `parseOverviewRanges`. Требует и
 * `unit_economics`, и `finance`: без журнала прибыли по товару нет.
 *
 * Площадка — `params.marketplace` (TASK-181), умолчание ЯМ: журнал своей площадки
 * (`FinanceService.build`), товары — по артикулу журнала
 * (`findByJournalSkus`: ключ закупа = артикул ЯМ, без карточки ЯМ — артикул площадки).
 */
@Injectable()
export class CrmUnitEconomicsKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly finance: FinanceService,
    private readonly products: ProductService,
  ) {}

  onModuleInit(): void {
    this.registry.register(UNIT_ECONOMICS_KIND, {
      features: [FEATURE.UNIT_ECONOMICS, FEATURE.FINANCE],
      scope: 'account',
      run: (context) => this.skus(context),
    });
  }

  async skus(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const ranges = parseOverviewRanges(context.params);
    if (!ranges) throw new CrmJobError(UNIT_ECONOMICS_RANGE_INVALID_TEXT);
    const parsed = parseJobMarketplace(context.params, context.features ?? {});
    if ('error' in parsed) throw new CrmJobError(parsed.text);
    const { marketplace } = parsed;

    const { telegramUserId } = context;
    const [current, previous] = await Promise.all([
      this.finance.build(telegramUserId, ranges.current, now, { flat: false, marketplace }),
      this.finance.build(telegramUserId, ranges.previous, now, { flat: false, marketplace }),
    ]);

    const skus = current.pnl.skus.skus.map((sku) => sku.sku);
    const products = await this.products.findByJournalSkus(telegramUserId, marketplace, skus);
    const names = new Map<string, string>();
    for (const [sku, product] of products) {
      if (product.name) names.set(sku, product.name);
    }

    return { data: toCrmUnitEconomics(current, previous, names, marketplace) };
  }
}
