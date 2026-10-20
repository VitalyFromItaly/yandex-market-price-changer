import type {
  IMarketplaceAdapter,
  IMarketplaceCallOrigin,
  IMarketplaceConnector,
} from './marketplace-adapter';
import type { IConnectionCheck } from './marketplace-connections.domain';

import { Injectable } from '@nestjs/common';

import { StoresService } from '../yandex/stores/stores.service';

import { connectionCheckText } from './marketplace-connections.domain';

/**
 * Подключение ЯМ как возможность адаптера (TASK-162). Статуса в базе у ЯМ нет
 * (`marketplace_connection_ym_virtual`): успех обновляет кэш `stores` и
 * `tokenCheckedAt`, отказ виден только в ответе — это правило
 * `StoresService.recheckToken`, здесь лишь перевод его исходов в общий.
 */
@Injectable()
export class YmConnectionAdapter implements IMarketplaceAdapter {
  readonly marketplace = 'ym' as const;

  constructor(private readonly stores: StoresService) {}

  readonly connection: IMarketplaceConnector = {
    secretField: 'token',
    check: (telegramUserId, origin) => this.check(telegramUserId, origin),
  };

  private async check(
    telegramUserId: string,
    origin: IMarketplaceCallOrigin,
  ): Promise<IConnectionCheck | null> {
    const result = await this.stores.recheckToken(telegramUserId, { telegramUserId, ...origin });
    if (result.ok === true) return { status: 'ok', message: connectionCheckText('ym', 'ok') };
    switch (result.reason) {
      case 'no-store':
        return null;
      case 'auth':
        return { status: 'rejected', message: result.message };
      case 'empty':
        return { status: 'empty', message: connectionCheckText('ym', 'empty') };
      default:
        return { status: 'unavailable', message: connectionCheckText('ym', 'unavailable') };
    }
  }
}
