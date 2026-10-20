import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';

import { type IOzonClientOptions, type IOzonCredentials, OzonSellerClient } from './ozon.client';

/**
 * Фабрика клиентов Ozon Seller API — паттерн YandexClientFactory.
 *
 * Провайдер синглтон, клиент — нет: у каждого продавца свои Client-Id и
 * Api-Key, а кэш по кредам означал бы, что ошибка в ключе кэша — запрос в чужой
 * кабинет. Базовый URL — только из AppConfigService (OZON_SELLER_API_URL).
 */
@Injectable()
export class OzonClientFactory {
  constructor(private readonly config: AppConfigService) {}

  forCredentials(credentials: IOzonCredentials, options?: IOzonClientOptions): OzonSellerClient {
    if (!credentials.clientId?.trim() || !credentials.apiKey?.trim()) {
      throw new Error('Нужны Client-Id и Api-Key');
    }
    return new OzonSellerClient(this.config.ozonSellerApiUrl, credentials, options);
  }
}
