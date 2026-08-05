import type { IWarehousesScreenData } from './warehouses-message';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { FbyStockService } from '../fby/fby-stock.service';
import { YandexClientFactory } from '../yandex-client.factory';

/**
 * Обзор складов продавца по типам вместе с остатками на складах Маркета.
 *
 * Тонкий сервис поверх фабрики клиентов: как OrderReportsService, он остаётся
 * API-only — только читает Partner API и ничего не пишет и не трогает базу.
 * Клиент создаётся из документа настроек продавца (свои токен и идентификаторы),
 * синглтоном быть не может (см. YandexApiClient).
 *
 * Источники асимметричны НАМЕРЕННО. Список складов — это и есть экран, его сбой
 * бросается наверх и превращается в отказ. Остатки — обогащение, их сбой МЯГКО
 * ДЕГРАДИРУЕТ (паттерн ProfitService.returnedOrderIds): экран показывает ровно
 * то, что показывал до появления цифр, плюс строку «почему их нет». Отдать
 * пустой экран из-за лимита генерации отчёта было бы обменом рабочего на ничего.
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly clients: YandexClientFactory,
    private readonly stockSource: FbyStockService,
  ) {}

  public async overview(store: YandexMarketDocument): Promise<IWarehousesScreenData> {
    const [overview, stock] = await Promise.all([
      this.clients.forStore(store).getWarehousesOverview(),
      this.stockSource.safeLoad(store),
    ]);

    return {
      overview,
      byWarehouse: stock.snapshot?.summary.byWarehouse ?? null,
      stockTakenAt: stock.snapshot?.takenAt,
      stockError: stock.error,
    };
  }
}
