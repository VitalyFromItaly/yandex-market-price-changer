import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { IWarehousesOverview } from '../yandex-api.client';

import { Injectable } from '@nestjs/common';

import { YandexClientFactory } from '../yandex-client.factory';

/**
 * Обзор складов продавца по типам.
 *
 * Тонкий сервис поверх фабрики клиентов: как OrderReportsService, он остаётся
 * API-only — только читает Partner API и ничего не пишет и не трогает базу.
 * Клиент создаётся из документа настроек продавца (свои токен и идентификаторы),
 * синглтоном быть не может (см. YandexApiClient).
 */
@Injectable()
export class WarehousesService {
  constructor(private readonly clients: YandexClientFactory) {}

  public async overview(store: YandexMarketDocument): Promise<IWarehousesOverview> {
    return await this.clients.forStore(store).getWarehousesOverview();
  }
}
