import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { ITariffQuote } from './tariff-quote';

import { Injectable } from '@nestjs/common';

import { YandexClientFactory } from '../yandex-client.factory';

import { tariffParamsOf, unitCostsOf } from './tariff-estimate';
import { splitQuote } from './tariff-quote';

/** Товара нет в каталоге магазина или у него нет категории — тариф не спросить. */
export class TariffQuoteUnavailableError extends Error {
  constructor(public readonly sku: string) {
    super(`Тариф для ${sku} не посчитать: нет в каталоге магазина или нет категории`);
  }
}

/**
 * Тариф Маркета для одного товара по цене (TASK-139). Только чтение: каталог
 * (`offer-mappings`) и `tariffs/calculate`, Partner API не пишется. Та же
 * цепочка, что `ProfitService.tariffEstimateOf`, но на одну пару
 * (артикул, цена) вместо набора заказов; параметры — общий `tariffParamsOf`.
 * Ошибки не глотаются: вызывает фоновая задача CRM, её процессор и сообщает.
 */
@Injectable()
export class TariffQuoteService {
  constructor(private readonly clients: YandexClientFactory) {}

  public async quote(
    store: YandexMarketDocument,
    sku: string,
    priceKopecks: number,
  ): Promise<ITariffQuote> {
    const client = this.clients.forStore(store);
    const logistics = await client.getOfferMappings([sku]);
    const params = tariffParamsOf(logistics.get(sku), priceKopecks / 100);
    if (!params) throw new TariffQuoteUnavailableError(sku);

    const calculations = await client.calculateTariffs([params]);
    const cost = unitCostsOf([{ key: sku, params }], calculations).get(sku);
    return splitQuote(priceKopecks, cost ?? { servicesTotal: 0, byService: {} });
  }
}
