import { Injectable } from '@nestjs/common';

import { type IWbClientOptions, WbClient } from './wb.client';

/**
 * Фабрика клиентов WB API — паттерн OzonClientFactory. Провайдер синглтон,
 * клиент — на токен: кэш по токену значил бы, что ошибка в ключе кэша —
 * запрос в чужой кабинет. Адреса — таблица хостов категорий в клиенте, без env:
 * у WB их десяток, и переопределять их по одному никому не нужно.
 */
@Injectable()
export class WbClientFactory {
  forToken(token: string, options?: IWbClientOptions): WbClient {
    if (!token?.trim()) throw new Error('Нужен токен WB');
    return new WbClient(token, options);
  }
}
