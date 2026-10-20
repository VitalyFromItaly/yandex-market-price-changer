import type {
  ICrmNotificationSettingsView,
  ICrmNotificationsView,
} from './crm-notifications.domain';
import type { ISellerNotificationSettingsPatch } from '../../../database/services/seller-notification-settings.service';

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { SellerNotificationSettingsService } from '../../../database/services/seller-notification-settings.service';
import { SellerNotificationService } from '../../../database/services/seller-notification.service';
import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { SellerNotificationsScheduler } from '../../telegram/queue/services/seller-notifications.scheduler';
import { RequireFeature } from '../crm-auth.decorators';
import { FEATURE_DISABLED } from '../crm-features.domain';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import {
  INVALID_SETTING,
  pageOf,
  parseReadBody,
  parseSettingsBody,
  toCrmNotificationSettings,
  toCrmNotifications,
} from './crm-notifications.domain';

/**
 * «Уведомления» CRM (TASK-152): центр уведомлений и настройки правил. Полный
 * адрес — /api/crm/ym/notifications. Раздел аккаунта, целиком под фичей
 * `notifications`; блок «Telegram» (вкл, время) — ещё и под
 * `notifications_telegram`. Проверку не считает: «Проверить сейчас» ставит
 * задачу в очередь `seller-notifications` (остатки площадок — живые вызовы).
 */
@Controller('crm/ym/notifications')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.NOTIFICATIONS)
export class CrmNotificationsController {
  constructor(
    private readonly feed: SellerNotificationService,
    private readonly settings: SellerNotificationSettingsService,
    private readonly scheduler: SellerNotificationsScheduler,
  ) {}

  @Get()
  async list(
    @Req() request: IRequestWithCrmUser,
    @Query('unread') unread: unknown,
    @Query('skip') skip: unknown,
    @Query('limit') limit: unknown,
  ): Promise<ICrmNotificationsView> {
    const page = await this.feed.list(request.crmUser.telegramUserId, {
      unreadOnly: unread === '1' || unread === 'true',
      ...pageOf(skip, limit),
    });
    return toCrmNotifications(page);
  }

  @Post('read')
  @HttpCode(200)
  async read(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<{ updated: number }> {
    const ids = parseReadBody(body);
    if (!ids) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_SETTING,
        field: 'ids',
        message: 'Нужен список id или { all: true }',
      });
    }
    const updated = await this.feed.markRead(request.crmUser.telegramUserId, ids, new Date());
    return { updated };
  }

  @Get('settings')
  async getSettings(@Req() request: IRequestWithCrmUser): Promise<ICrmNotificationSettingsView> {
    return this.settingsView(request);
  }

  @Put('settings')
  async putSettings(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmNotificationSettingsView> {
    const parsed = parseSettingsBody(body);
    // `in`, а не `ok`: без strictNullChecks union по литералу не сужается.
    if ('field' in parsed) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_SETTING,
        field: parsed.field,
        message: parsed.message,
      });
    }
    const { patch } = parsed as { patch: ISellerNotificationSettingsPatch };
    const touchesTelegram = patch.telegram !== undefined || patch.time !== undefined;
    if (touchesTelegram && !this.telegramOpen(request)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: FEATURE_DISABLED,
        message: 'Уведомления в Telegram недоступны',
      });
    }
    const before = await this.settings.get(request.crmUser.telegramUserId);
    await this.settings.update(request.crmUser.telegramUserId, patch);
    // Время — это cron повторяемой задачи: пересверка переставит её сейчас.
    if (patch.time !== undefined && patch.time !== before.time) await this.scheduler.refresh();
    return this.settingsView(request);
  }

  @Post('check')
  @HttpCode(202)
  async check(@Req() request: IRequestWithCrmUser): Promise<{ queued: true }> {
    await this.scheduler.checkNow(request.crmUser.telegramUserId);
    return { queued: true };
  }

  private telegramOpen(request: IRequestWithCrmUser): boolean {
    return isFeatureEnabled(request.crmUser.features, FEATURE.NOTIFICATIONS_TELEGRAM);
  }

  private async settingsView(request: IRequestWithCrmUser): Promise<ICrmNotificationSettingsView> {
    const settings = await this.settings.get(request.crmUser.telegramUserId);
    return toCrmNotificationSettings(settings, this.telegramOpen(request));
  }
}
