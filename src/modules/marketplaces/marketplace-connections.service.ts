import type {
  IConnectionCard,
  IConnectionCheck,
  IMarketplaceConnectionView,
  IStoredConnectionSource,
} from './marketplace-connections.domain';
import type { TMarketplace } from '../../shared/marketplace';
import type { TFeatureMap } from '../telegram/bots/shared/features.domain';

import { Injectable } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';

import {
  availableMarketplaces,
  connectionCards,
  connectionsView,
} from './marketplace-connections.domain';
import { MarketplaceRegistry } from './marketplace-registry.service';

/** Повторная проверка: карточка после неё и что ответила площадка. */
export interface IConnectionCheckResult {
  connection: IConnectionCard;
  check: IConnectionCheck;
}

/**
 * Площадки продавца одним списком (TASK-127): ЯМ из `YandexMarket`, Ozon/WB из
 * `MarketplaceConnection`. Два запроса в Mongo параллельно; правило — в чистой
 * `connectionsView`.
 */
@Injectable()
export class MarketplaceConnectionsService {
  constructor(
    private readonly yandexMarket: YandexMarketService,
    private readonly connections: MarketplaceConnectionService,
    private readonly registry: MarketplaceRegistry,
  ) {}

  /** `features` — снимок фич продавца (у админа — все открыты), решает «доступна / скоро». */
  async list(telegramUserId: string, features: TFeatureMap): Promise<IMarketplaceConnectionView[]> {
    const [ym, rows] = await Promise.all([
      this.yandexMarket.findByTelegramUser(telegramUserId),
      this.connections.findForUser(telegramUserId),
    ]);
    const available = availableMarketplaces(
      this.registry.supported(),
      this.registry.connectable(),
      features,
    );
    return connectionsView(ym, rows, available);
  }

  /**
   * Карточки «Подключений» (TASK-161). Креды Ozon/WB читаются только ради
   * маски — `credentialsOf`, по запросу на подключённую площадку.
   */
  async cards(telegramUserId: string, features: TFeatureMap): Promise<IConnectionCard[]> {
    const [ym, rows] = await Promise.all([
      this.yandexMarket.findByTelegramUser(telegramUserId),
      this.connections.findForUser(telegramUserId),
    ]);
    const stored: IStoredConnectionSource[] = await Promise.all(
      rows.map(async (row) => {
        const credentials = await this.connections.credentialsOf(telegramUserId, row.marketplace);
        const field = this.registry.capability(row.marketplace, 'connection')?.secretField;
        return { row, secret: (field && credentials?.[field]) || null };
      }),
    );
    return connectionCards(ym, stored, this.available(features));
  }

  /**
   * «Проверить связь»: записанный ключ ещё раз спрашивает площадка. Ключ не
   * меняется ни в одном исходе. null — площадка не подключена. Площадка без
   * подключения в реестре — тоже null. Как спросить, знает адаптер площадки
   * (`IMarketplaceConnector`), ветвлений по площадкам здесь нет (TASK-162).
   * Фичу площадки проверяет вызывающий (гвард CRM).
   */
  async check(
    telegramUserId: string,
    marketplace: TMarketplace,
    features: TFeatureMap,
  ): Promise<IConnectionCheckResult | null> {
    const connector = this.registry.capability(marketplace, 'connection');
    const check = connector
      ? await connector.check(telegramUserId, { source: 'crm', context: 'crm-connections:check' })
      : null;
    if (!check) return null;
    const cards = await this.cards(telegramUserId, features);
    const connection = cards.find((card) => card.key === marketplace);
    return connection ? { connection, check } : null;
  }

  private available(features: TFeatureMap): TMarketplace[] {
    return availableMarketplaces(this.registry.supported(), this.registry.connectable(), features);
  }
}
