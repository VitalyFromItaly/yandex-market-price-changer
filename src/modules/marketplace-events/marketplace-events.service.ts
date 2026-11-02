import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { StockPushSettingsService } from '../../database/services/stock-push-settings.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { ErrorReporter } from '../errors/error-reporter.service';
import {
  eventAckOf,
  isEventMarketplace,
  isEventSourceAllowed,
  parseMarketplaceEvent,
} from '../stock-push/marketplace-events';
import { StockPushScheduler } from '../telegram/queue/services/stock-push.scheduler';

/** Что ответить площадке: код и тело. */
export interface IEventReply {
  status: 200 | 400 | 403 | 404;
  body: unknown;
}

const NOT_FOUND: IEventReply = {
  status: 404,
  body: { error: { code: 'NOT_FOUND', message: 'Unknown address' } },
};

/**
 * Приём уведомлений площадок о заказах (решение `stock_push_on_marketplace_event`).
 * Продавец — по секрету адреса; проход ставится в очередь, здесь только решение
 * «ставить или нет», чтобы ответить в секунду (PING ЯМ — 1 с).
 *
 * На всё корректное — 200, даже если проход не положен или Redis упал: иначе ЯМ
 * держит все следующие уведомления продавца, а через 14 дней отключает подписку.
 * Пропущенное событие догонит расписание. 404 — чужой адрес (продавец увидит
 * ошибку при подключении), 400 — тело не похоже на уведомление площадки, 403 —
 * IP не из сетей площадки (`MARKETPLACE_WEBHOOK_IP_CHECK`).
 */
@Injectable()
export class MarketplaceEventsService {
  private readonly logger = new Logger(MarketplaceEventsService.name);

  constructor(
    private readonly settings: StockPushSettingsService,
    private readonly stores: YandexMarketService,
    private readonly scheduler: StockPushScheduler,
    private readonly errors: ErrorReporter,
    private readonly config: AppConfigService,
  ) {}

  async receive(
    marketplace: string,
    secret: string,
    body: unknown,
    ip: string | undefined,
    now: Date = new Date(),
  ): Promise<IEventReply> {
    if (!isEventMarketplace(marketplace)) return NOT_FOUND;
    // IP — до секрета: с чужого адреса секреты не перебираются.
    if (this.config.marketplaceWebhookIpCheck && !isEventSourceAllowed(marketplace, ip)) {
      void this.errors.report({
        error: new Error(
          `Уведомление ${marketplace} с чужого IP ${ip ?? '?'} отвергнуто. Если это площадка — ` +
            'перед nginx стоит ещё прокси, IP клиента не виден (MARKETPLACE_WEBHOOK_IP_CHECK)',
        ),
        source: 'http',
        context: `stock-push:event:ip:${marketplace}`,
      });
      return {
        status: 403,
        body: { error: { code: 'FORBIDDEN_SOURCE', message: 'Forbidden source', details: null } },
      };
    }
    const owner = await this.settings.findBySecret(secret);
    if (!owner) return NOT_FOUND;

    const event = parseMarketplaceEvent(marketplace, body);
    const ack: IEventReply = { status: 200, body: eventAckOf(now) };
    if (event.kind === 'invalid') {
      return {
        status: 400,
        body: {
          error: {
            code: 'ERROR_PARAMETER_VALUE_MISSED',
            message: 'Unexpected body',
            details: null,
          },
        },
      };
    }
    if (event.kind !== 'stock') return ack;

    const { telegramUserId } = owner;
    try {
      if (marketplace === 'ym' && !(await this.ownsCampaign(telegramUserId, event.campaignId))) {
        // Адрес продавца вставлен в чужой кабинет: заказы не его — проход не ставим.
        this.logger.warn(`Уведомление ЯМ о чужом магазине для ${telegramUserId}`);
        return ack;
      }
      await this.settings.markEvent(telegramUserId, marketplace, now);
      if (await this.scheduler.featuresAfterEvent(telegramUserId)) {
        await this.scheduler.sendAfterEvent(telegramUserId, now.getTime());
      }
    } catch (error) {
      void this.errors.report({
        error,
        source: 'queue',
        context: `stock-push:event:${marketplace}`,
        telegramUserId,
      });
    }
    return ack;
  }

  /** Магазин из уведомления — среди магазинов токена продавца (кэш `stores`). */
  private async ownsCampaign(
    telegramUserId: string,
    campaignId: string | undefined,
  ): Promise<boolean> {
    if (!campaignId) return false;
    const doc = await this.stores.findByTelegramUser(telegramUserId);
    if (!doc) return false;
    if (String(doc.campaign_id) === campaignId) return true;
    return (doc.stores ?? []).some((store) => store.campaignId === campaignId);
  }
}
