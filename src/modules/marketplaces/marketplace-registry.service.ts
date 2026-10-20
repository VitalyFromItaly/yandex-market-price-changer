import type {
  IMarketplaceAdapter,
  IMarketplaceCapabilities,
  TMarketplaceCapability,
} from './marketplace-adapter';
import type { TMarketplace } from '../../shared/marketplace';

import { Injectable } from '@nestjs/common';

import { MARKETPLACES } from '../../shared/marketplace';
import { OzonMarketplaceAdapter } from '../ozon/ozon-marketplace.adapter';
import { WbMarketplaceAdapter } from '../wb/wb-marketplace.adapter';

import { MARKETPLACE_CAPABILITIES, MarketplaceNotConnectedError } from './marketplace-adapter';
import { YmConnectionAdapter } from './ym-connection.adapter';
import { YmMarketplaceAdapter } from './ym-marketplace.adapter';

type TCapabilityTable = Partial<Record<TMarketplace, Partial<IMarketplaceCapabilities>>>;

/**
 * Единственная дверь к площадкам (TASK-127, TASK-162). Потребитель называет
 * площадку и возможность — какой класс за этим стоит, решает реестр.
 *
 * Площадка регистрирует только то, что умеет: у Ozon и WB сейчас одно
 * подключение. Спросить у них финансы — `MarketplaceNotConnectedError`
 * (`no-adapter`), а не заглушка, которая бросает «не реализовано» где-то в
 * глубине ночной загрузки (решение `ozon_adapter_after_finance`). Новая
 * возможность площадки — новое поле её адаптера, и только.
 */
@Injectable()
export class MarketplaceRegistry {
  private readonly table: TCapabilityTable;

  constructor(
    ym: YmMarketplaceAdapter,
    ymConnection: YmConnectionAdapter,
    ozon: OzonMarketplaceAdapter,
    wb: WbMarketplaceAdapter,
  ) {
    this.table = capabilityTable([ym, ymConnection, ozon, wb]);
  }

  /** Реализация возможности или null, если площадка её не умеет. */
  capability<C extends TMarketplaceCapability>(
    marketplace: TMarketplace,
    capability: C,
  ): IMarketplaceCapabilities[C] | null {
    return (this.table[marketplace]?.[capability] as IMarketplaceCapabilities[C]) ?? null;
  }

  /** То же, но отсутствие — отказ: вызывающему без возможности делать нечего. */
  require<C extends TMarketplaceCapability>(
    marketplace: TMarketplace,
    capability: C,
    telegramUserId = '',
  ): IMarketplaceCapabilities[C] {
    const found = this.capability(marketplace, capability);
    if (!found) {
      throw new MarketplaceNotConnectedError(marketplace, telegramUserId, 'no-adapter', capability);
    }
    return found;
  }

  /** Площадки, умеющие возможность, — в порядке общего списка. */
  withCapability(capability: TMarketplaceCapability): TMarketplace[] {
    return MARKETPLACES.filter((key) => this.capability(key, capability) !== null);
  }

  /** Площадки, у которых есть данные (хоть одна возможность кроме подключения). */
  supported(): TMarketplace[] {
    return MARKETPLACES.filter((key) =>
      MARKETPLACE_CAPABILITIES.some(
        (capability) => capability !== 'connection' && this.capability(key, capability) !== null,
      ),
    );
  }

  /** Площадки, ключ которых можно подключить и проверить. */
  connectable(): TMarketplace[] {
    return this.withCapability('connection');
  }
}

/**
 * Части адаптеров одной площадки складываются; одна возможность, заявленная
 * дважды, — ошибка сборки, а не «победил последний».
 */
export function capabilityTable(parts: readonly IMarketplaceAdapter[]): TCapabilityTable {
  const table: TCapabilityTable = {};
  for (const part of parts) {
    const entry = (table[part.marketplace] ??= {});
    for (const capability of MARKETPLACE_CAPABILITIES) {
      const implementation = part[capability];
      if (!implementation) continue;
      if (entry[capability]) {
        throw new Error(`Площадка ${part.marketplace}: возможность ${capability} заявлена дважды`);
      }
      (entry as Record<TMarketplaceCapability, unknown>)[capability] = implementation;
    }
  }
  return table;
}
