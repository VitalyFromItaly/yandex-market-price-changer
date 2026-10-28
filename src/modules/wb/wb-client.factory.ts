import { Injectable } from '@nestjs/common';

import { WbStatisticsPacer } from './wb-statistics-pacer';
import { type IWbClientOptions, WbClient } from './wb.client';

/**
 * Фабрика клиентов WB API — паттерн OzonClientFactory. Провайдер синглтон,
 * клиент — на токен: кэш по токену значил бы, что ошибка в ключе кэша —
 * запрос в чужой кабинет. Адреса — таблица хостов категорий в клиенте, без env:
 * у WB их десяток, и переопределять их по одному никому не нужно.
 */
@Injectable()
export class WbClientFactory {
  /** Один на процесс: лимит статистики — на продавца, а клиентов на токен много. */
  private readonly pacer = new WbStatisticsPacer();

  forToken(token: string, options?: IWbClientOptions): WbClient {
    if (!token?.trim()) throw new Error('Нужен токен WB');
    return new WbClient(token, { pacer: this.pacer, ...options });
  }
}
