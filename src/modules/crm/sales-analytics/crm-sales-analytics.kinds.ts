import type { IBrandSource } from '../../yandex/reports/brands';
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
 *
 * Площадка — `params.marketplace` (TASK-181), умолчание ЯМ: журнал своей площадки
 * (`FinanceService.build`), товары — по артикулу журнала
 * (`findByJournalSkus`: ключ закупа = артикул ЯМ, без карточки ЯМ — артикул площадки).
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
    const parsed = parseJobMarketplace(context.params, context.features ?? {});
    if ('error' in parsed) throw new CrmJobError(parsed.text);
    const { marketplace } = parsed;

    const { telegramUserId } = context;
    const [current, previous] = await Promise.all([
      this.finance.build(telegramUserId, ranges.current, now, { flat: false, marketplace }),
      this.finance.build(telegramUserId, ranges.previous, now, { flat: false, marketplace }),
    ]);

    // Бренд прошлого периода нужен тоже: иначе товар, проданный только тогда,
    // попал бы в «Остальные» и сдвинул динамику бренда.
    const skus = [
      ...new Set([...current.pnl.skus.skus, ...previous.pnl.skus.skus].map((sku) => sku.sku)),
    ];
    const found = await this.products.findByJournalSkus(telegramUserId, marketplace, skus);
    const products = new Map<string, IBrandSource>();
    for (const [sku, product] of found) {
      products.set(sku, { name: product.name, category: product.category });
    }

    return { data: toCrmSalesAnalytics(current, previous, products, marketplace) };
  }
}
