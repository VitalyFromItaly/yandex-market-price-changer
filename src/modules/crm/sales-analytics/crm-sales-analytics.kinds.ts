import type { IBrandSource } from '../../yandex/reports/brands';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { ProductService } from '../../../database/services/product.service';
import { FinanceService } from '../../finance/finance.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';
import { parseOverviewRanges } from '../overview/crm-overview.domain';

import {
  SALES_ANALYTICS_KIND,
  SALES_ANALYTICS_RANGE_INVALID_TEXT,
  toCrmSalesAnalytics,
} from './crm-sales-analytics.domain';

/**
 * Kind «Аналитики продаж» (TASK-140), уровня аккаунта.
 *
 * Текущий и прошлый период — два `FinanceService.build` без плоской оценки,
 * периоды присылает браузер (`from/to`, `prevFrom/prevTo`), разбор — общий с
 * «Обзором» `parseOverviewRanges`. Фича одна: `sales_analytics` требует
 * `finance` сама (`requires`). Бренд не хранится — выводится из названия и
 * категории товара (`brandOf`), поэтому из базы товаров берутся оба поля.
 */
@Injectable()
export class CrmSalesAnalyticsKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly finance: FinanceService,
    private readonly products: ProductService,
  ) {}

  onModuleInit(): void {
    this.registry.register(SALES_ANALYTICS_KIND, {
      features: [FEATURE.SALES_ANALYTICS],
      scope: 'account',
      run: (context) => this.summary(context),
    });
  }

  async summary(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const ranges = parseOverviewRanges(context.params);
    if (!ranges) throw new CrmJobError(SALES_ANALYTICS_RANGE_INVALID_TEXT);

    const { telegramUserId } = context;
    const [current, previous] = await Promise.all([
      this.finance.build(telegramUserId, ranges.current, now, { flat: false }),
      this.finance.build(telegramUserId, ranges.previous, now, { flat: false }),
    ]);

    // Бренд прошлого периода нужен тоже: иначе товар, проданный только тогда,
    // попал бы в «Остальные» и сдвинул динамику бренда.
    const skus = [
      ...new Set([...current.pnl.skus.skus, ...previous.pnl.skus.skus].map((sku) => sku.sku)),
    ];
    const found = skus.length ? await this.products.findByYmSkus(telegramUserId, skus) : [];
    const products = new Map<string, IBrandSource>();
    for (const product of found) {
      const ym = product.marketplaceSkus?.ym;
      if (ym) products.set(ym, { name: product.name, category: product.category });
    }

    return { data: toCrmSalesAnalytics(current, previous, products) };
  }
}
