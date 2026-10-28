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
  SKU_RATINGS_KIND,
  SKU_RATINGS_RANGE_INVALID_TEXT,
  toCrmSkuRatings,
} from './crm-sku-ratings.domain';

/**
 * Kind «Рейтингов и классификаций» (TASK-141), уровня аккаунта.
 *
 * Текущий и прошлый период — два `FinanceService.build` без плоской оценки
 * (прошлый нужен спросу), периоды присылает браузер, разбор — общий с «Обзором»
 * `parseOverviewRanges`. `sku_ratings` требует `finance` сама (`requires`).
 * Название и бренд — из базы товаров по объединению артикулов обоих периодов:
 * товар «падающего спроса» мог продаваться только в прошлом.
 *
 * Площадка — `params.marketplace` (TASK-181), умолчание ЯМ: журнал своей площадки
 * (`FinanceService.build`), товары — по артикулу журнала
 * (`findByJournalSkus`: ключ закупа = артикул ЯМ, без карточки ЯМ — артикул площадки).
 */
@Injectable()
export class CrmSkuRatingsKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly finance: FinanceService,
    private readonly products: ProductService,
  ) {}

  onModuleInit(): void {
    this.registry.register(SKU_RATINGS_KIND, {
      features: [FEATURE.SKU_RATINGS],
      scope: 'account',
      run: (context) => this.summary(context),
    });
  }

  async summary(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    const ranges = parseOverviewRanges(context.params);
    if (!ranges) throw new CrmJobError(SKU_RATINGS_RANGE_INVALID_TEXT);
    const parsed = parseJobMarketplace(context.params, context.features ?? {});
    if ('error' in parsed) throw new CrmJobError(parsed.text);
    const { marketplace } = parsed;

    const { telegramUserId } = context;
    // По очереди, а не `Promise.all`: пул Postgres — 10 соединений (README finance).
    const current = await this.finance.build(telegramUserId, ranges.current, now, {
      flat: false,
      marketplace,
    });
    const previous = await this.finance.build(telegramUserId, ranges.previous, now, {
      flat: false,
      marketplace,
    });

    // Товар, проданный только в прошлом периоде, — в «падающем спросе»: ему тоже нужно название.
    const skus = [
      ...new Set([...current.pnl.skus.skus, ...previous.pnl.skus.skus].map((sku) => sku.sku)),
    ];
    const found = await this.products.findByJournalSkus(telegramUserId, marketplace, skus);
    const products = new Map<string, IBrandSource>();
    for (const [sku, product] of found) {
      products.set(sku, { name: product.name, category: product.category });
    }

    return { data: toCrmSkuRatings(current, previous, products, marketplace) };
  }
}
