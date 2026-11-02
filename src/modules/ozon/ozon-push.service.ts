import type { TOzonPushState } from './ozon-push.domain';

import { Injectable } from '@nestjs/common';

import { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';

import { OzonClientFactory } from './ozon-client.factory';
import { OZON_PUSH_ORDER_TYPES, planOzonPush } from './ozon-push.domain';
import { ozonSellerClient } from './ozon-seller-client';

/**
 * Подписка продавца на push-уведомления Ozon о заказах (`ozon_push_subscribe_via_api`).
 * Пишет в настройки кабинета продавца — только по его кнопке в CRM и при смене
 * адреса. Запись — без повторов (`callWrite` клиента).
 */
@Injectable()
export class OzonPushService {
  constructor(
    private readonly clients: OzonClientFactory,
    private readonly connections: MarketplaceConnectionService,
  ) {}

  async status(telegramUserId: string, ourUrl: string, ourPrefix: string): Promise<TOzonPushState> {
    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const [urls, types] = await Promise.all([
      client.listNotificationUrls(),
      client.listPushTypes(),
    ]);
    return planOzonPush(urls, types, ourUrl, ourPrefix).status;
  }

  /** Подключить наш адрес; тип занят чужим — ничего не пишем и отдаём `occupied`. */
  async connect(
    telegramUserId: string,
    ourUrl: string,
    ourPrefix: string,
  ): Promise<TOzonPushState> {
    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const [urls, types] = await Promise.all([
      client.listNotificationUrls(),
      client.listPushTypes(),
    ]);
    const { status, action } = planOzonPush(urls, types, ourUrl, ourPrefix);
    if (action.kind === 'none') return status;
    if (action.kind === 'set') await client.setNotificationUrl(ourUrl, OZON_PUSH_ORDER_TYPES);
    else await client.updateNotificationUrl(action.id, ourUrl, OZON_PUSH_ORDER_TYPES);
    return await this.status(telegramUserId, ourUrl, ourPrefix);
  }

  /**
   * Сменили секрет: наш подключённый адрес перенаправить на новый. Нашего нет —
   * ничего (продавец Ozon отсюда не подключал). true — перенаправили.
   */
  async repoint(telegramUserId: string, newUrl: string, ourPrefix: string): Promise<boolean> {
    const client = await ozonSellerClient(this.clients, this.connections, telegramUserId);
    const ours = (await client.listNotificationUrls()).find((url) => url.url.startsWith(ourPrefix));
    if (!ours) return false;
    await client.updateNotificationUrl(ours.id, newUrl, OZON_PUSH_ORDER_TYPES);
    return true;
  }
}
