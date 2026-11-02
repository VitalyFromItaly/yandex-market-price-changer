import type { ICatalogLink } from '../yandex/stocks/stock-sync.service';

import { Injectable, Logger } from '@nestjs/common';

import { MARKETPLACE_LABEL } from '../../shared/marketplace';
import { ErrorReporter } from '../errors/error-reporter.service';
import { MarketplaceNotConnectedError } from '../marketplaces/marketplace-adapter';
import { MarketplaceRegistry } from '../marketplaces/marketplace-registry.service';
import { ProductMatchService } from '../products/product-match.service';
import { MATCH_LEVELS } from '../products/product.domain';
import { FEATURE, isFeatureEnabled } from '../telegram/bots/shared/features.domain';
import { reportErrorMessage } from '../yandex/reports/report-message';

export type TCatalogLinkMarketplace = 'ozon' | 'wb';

/** Площадка → фича, без которой её каталог не спрашивается. */
const LINK_FEATURE = { ozon: FEATURE.OZON, wb: FEATURE.WB } as const;

/**
 * Какие каталоги сопоставлять при загрузке — решается при постановке задачи,
 * там же, где фичи прайса. Админ минует флаги, как в FeatureGateHandler.
 */
export function catalogLinkMarketplaces(
  features: Readonly<Record<string, boolean>> | undefined,
  isAdmin = false,
): TCatalogLinkMarketplace[] {
  return (['ozon', 'wb'] as const).filter(
    (marketplace) => isAdmin || isFeatureEnabled(features, LINK_FEATURE[marketplace]),
  );
}

/**
 * Карточки Ozon/WB → товары при каждой загрузке прайса (решение
 * `catalog_link_on_price_list`, 2026-11-02). У ЯМ строка прайса находит
 * карточку сама — по каталогу ЯМ в `sync`; у Ozon/WB тот же шаг делал только
 * CLI `sync-ozon-catalog.ts`, и без него «Передача остатков» писать на Ozon/WB
 * было нечего (прод 406937947: 0 привязок, прогон дал 471/471 и 2271/2273).
 *
 * Сопоставление — `ProductMatchService.syncCatalog`, своей логики нет: уже
 * привязанное и отвязанное руками не трогается. Пишется только наша Mongo.
 * Сбой площадки загрузку не роняет — строка итога с причиной и алерт.
 */
@Injectable()
export class CatalogLinkService {
  private readonly logger = new Logger(CatalogLinkService.name);

  constructor(
    private readonly registry: MarketplaceRegistry,
    private readonly matching: ProductMatchService,
    private readonly errors: ErrorReporter,
  ) {}

  async link(
    telegramUserId: string,
    marketplaces: readonly TCatalogLinkMarketplace[],
  ): Promise<ICatalogLink[]> {
    const links: ICatalogLink[] = [];
    for (const marketplace of marketplaces) {
      const catalog = this.registry.capability(marketplace, 'catalog');
      if (!catalog) continue;
      try {
        const rows = await catalog.listProducts({ telegramUserId, marketplace });
        const { match } = await this.matching.syncCatalog(telegramUserId, marketplace, rows);
        const matched =
          match.linked + MATCH_LEVELS.reduce((sum, level) => sum + match.matched[level], 0);
        links.push({ marketplace, cards: match.cards, matched });
      } catch (error) {
        if (error instanceof MarketplaceNotConnectedError) continue;
        this.logger.warn(
          `Каталог ${MARKETPLACE_LABEL[marketplace]} не сопоставлен: ${String(error)}`,
        );
        void this.errors.report({
          error,
          source: marketplace,
          context: `catalog-link:${marketplace}`,
          telegramUserId,
          action: 'сопоставление карточек при загрузке прайса',
        });
        links.push({ marketplace, cards: 0, matched: 0, error: reportErrorMessage(error) });
      }
    }
    return links;
  }
}
