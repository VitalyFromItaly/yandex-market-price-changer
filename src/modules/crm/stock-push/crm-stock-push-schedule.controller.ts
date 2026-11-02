import type { ICrmOzonPushView, ICrmPushScheduleView } from './crm-stock-push.domain';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { StockPushSettingsService } from '../../../database/services/stock-push-settings.service';
import { ErrorReporter } from '../../errors/error-reporter.service';
import { OzonPushService } from '../../ozon/ozon-push.service';
import { webhookPrefixOf, webhookUrlOf } from '../../stock-push/marketplace-events';
import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { StockPushScheduler } from '../../telegram/queue/services/stock-push.scheduler';
import { RequireFeature } from '../crm-auth.decorators';
import { FEATURE_DISABLED } from '../crm-features.domain';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import {
  INVALID_INTERVAL,
  INVALID_INTERVAL_TEXT,
  OZON_PUSH_UNAVAILABLE,
  STOCK_PUSH_EVENTS_UNAVAILABLE,
  ozonPushErrorView,
  parseInterval,
  toCrmOzonPush,
  toCrmPushEvents,
  toCrmPushSchedule,
} from './crm-stock-push.domain';

/**
 * Синхронизация остатков по расписанию — частота от продавца
 * (`stock_push_interval_by_seller`). Уровень продавца, не магазина: проход
 * пишет все площадки и магазины разом. Под `stock_push_schedule` — её
 * по-прежнему открывает администратор; частоту и «выключить» выбирает продавец.
 *
 * Синхронизация по заказу (`stock_push_events`): адреса уведомлений, смена
 * адреса и подписка Ozon через Seller API (`ozon_push_subscribe_via_api`).
 */
@Controller('crm/ym/stock-push/schedule')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.STOCK_PUSH_SCHEDULE)
export class CrmStockPushScheduleController {
  constructor(
    private readonly scheduler: StockPushScheduler,
    private readonly settings: StockPushSettingsService,
    private readonly config: AppConfigService,
    private readonly ozonPush: OzonPushService,
    private readonly errors: ErrorReporter,
  ) {}

  @Get()
  async get(@Req() request: IRequestWithCrmUser): Promise<ICrmPushScheduleView> {
    return await this.view(request);
  }

  @Put()
  async put(
    @Req() request: IRequestWithCrmUser,
    @Body() body: { interval?: unknown },
  ): Promise<ICrmPushScheduleView> {
    const interval = parseInterval(body?.interval);
    if (!interval) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_INTERVAL,
        message: INVALID_INTERVAL_TEXT,
      });
    }
    await this.scheduler.setInterval(request.crmUser.telegramUserId, interval);
    return await this.view(request);
  }

  /**
   * Сменить адрес уведомлений: старый перестаёт работать сразу. Подписку Ozon,
   * подключённую отсюда, перенаправляем сами; сбой Ozon смену не отменяет — экран
   * покажет «не подключена», и продавец нажмёт «Подключить».
   */
  @Post('webhook-secret')
  async rotateSecret(@Req() request: IRequestWithCrmUser): Promise<ICrmPushScheduleView> {
    this.assertEvents(request);
    const { telegramUserId, features } = request.crmUser;
    const { secret } = await this.settings.rotateWebhookSecret(telegramUserId);
    const base = this.config.publicBaseUrl;
    if (base && isFeatureEnabled(features ?? {}, FEATURE.OZON)) {
      const url = webhookUrlOf(base, 'ozon', secret);
      await this.ozonPush
        .repoint(telegramUserId, url, webhookPrefixOf(base, 'ozon'))
        .catch((error: unknown) =>
          this.errors.report({
            error,
            source: 'ozon',
            context: 'stock-push:event:repoint',
            telegramUserId,
          }),
        );
    }
    return await this.view(request);
  }

  /** Подписка Ozon — живой вызов Ozon, поэтому отдельно от карточки. */
  @Get('ozon-subscription')
  async ozonStatus(@Req() request: IRequestWithCrmUser): Promise<ICrmOzonPushView> {
    const { url, prefix } = await this.ozonTarget(request);
    try {
      return toCrmOzonPush(await this.ozonPush.status(request.crmUser.telegramUserId, url, prefix));
    } catch (error) {
      return ozonPushErrorView(error);
    }
  }

  /** «Подключить» — запись в настройки кабинета Ozon продавца, по его кнопке. */
  @Post('ozon-subscription')
  async ozonConnect(@Req() request: IRequestWithCrmUser): Promise<ICrmOzonPushView> {
    const { url, prefix } = await this.ozonTarget(request);
    const { telegramUserId } = request.crmUser;
    try {
      return toCrmOzonPush(await this.ozonPush.connect(telegramUserId, url, prefix));
    } catch (error) {
      void this.errors.report({
        error,
        source: 'ozon',
        context: 'stock-push:event:subscribe',
        telegramUserId,
      });
      return ozonPushErrorView(error);
    }
  }

  private async view(request: IRequestWithCrmUser): Promise<ICrmPushScheduleView> {
    const status = await this.scheduler.statusFor(request.crmUser.telegramUserId);
    return await this.withEvents(request, toCrmPushSchedule(status));
  }

  private assertEvents(request: IRequestWithCrmUser): void {
    if (!isFeatureEnabled(request.crmUser.features ?? {}, FEATURE.STOCK_PUSH_EVENTS)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: FEATURE_DISABLED,
        message: 'Синхронизация по заказу недоступна',
      });
    }
  }

  /** Наш адрес Ozon продавца; без Ozon — 403, без PUBLIC_BASE_URL — 409 с текстом. */
  private async ozonTarget(request: IRequestWithCrmUser): Promise<{ url: string; prefix: string }> {
    this.assertEvents(request);
    if (!isFeatureEnabled(request.crmUser.features ?? {}, FEATURE.OZON)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: FEATURE_DISABLED,
        message: 'Ozon недоступен',
      });
    }
    const base = this.config.publicBaseUrl;
    if (!base) {
      throw new ConflictException({
        statusCode: 409,
        code: OZON_PUSH_UNAVAILABLE,
        message: STOCK_PUSH_EVENTS_UNAVAILABLE,
      });
    }
    const secret = await this.settings.ensureWebhookSecret(request.crmUser.telegramUserId);
    return { url: webhookUrlOf(base, 'ozon', secret), prefix: webhookPrefixOf(base, 'ozon') };
  }

  /**
   * Блок «Синхронизация по заказу» — при открытой `stock_push_events`: секрет
   * заводится при первом показе, адрес собирается из PUBLIC_BASE_URL.
   */
  private async withEvents(
    request: IRequestWithCrmUser,
    view: ICrmPushScheduleView,
  ): Promise<ICrmPushScheduleView> {
    const { telegramUserId, features } = request.crmUser;
    if (!isFeatureEnabled(features ?? {}, FEATURE.STOCK_PUSH_EVENTS)) return view;
    const [secret, lastEventAt] = await Promise.all([
      this.settings.ensureWebhookSecret(telegramUserId),
      this.settings.lastEventsOf(telegramUserId),
    ]);
    return { ...view, events: toCrmPushEvents(this.config.publicBaseUrl, secret, lastEventAt) };
  }
}
