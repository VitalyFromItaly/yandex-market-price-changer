import type { IQuarantineOffer } from './quarantine.domain';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { YandexClientFactory } from '../yandex-client.factory';

import { QuarantinePartialConfirmError } from './quarantine.domain';

/**
 * Карантин цен — ядро на оба канала: чтение списка и подтверждение.
 *
 * Магазин приходит готовым: бот передаёт активный, CRM — перекрытый ключом из
 * адреса (`StoresService.resolve`). Где искать магазин, как хранить индексы
 * кнопок и как рисовать экран — забота каналов, не сервиса.
 *
 * Имя — не `PriceQuarantineService`: такой класс есть в сгенерированном
 * (мёртвом) клиенте `src/modules/yandex/api/services/`.
 */
@Injectable()
export class QuarantineService {
  constructor(private readonly clients: YandexClientFactory) {}

  /** Весь карантин кабинета (он бизнесовый, не магазинный). */
  async list(store: YandexMarketDocument): Promise<IQuarantineOffer[]> {
    return this.clients.forStore(store).getQuarantineOffers();
  }

  /**
   * Подтвердить цены. Возвращает число подтверждённых.
   *
   * Сбой после хотя бы одного успешного батча — `QuarantinePartialConfirmError`
   * (часть уже на витрине); сбой на первом — исходная ошибка, с её
   * `userMessage`, если это ошибка Маркета.
   */
  async confirm(store: YandexMarketDocument, offerIds: readonly string[]): Promise<number> {
    const unique = [...new Set(offerIds)];
    if (!unique.length) return 0;

    let confirmed = 0;
    try {
      await this.clients.forStore(store).confirmQuarantinePrices(unique, (done) => {
        confirmed = done;
      });
    } catch (error) {
      if (confirmed > 0) throw new QuarantinePartialConfirmError(confirmed, unique.length, error);
      throw error;
    }
    return unique.length;
  }
}
