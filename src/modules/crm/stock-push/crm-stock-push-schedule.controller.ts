import type { ICrmPushScheduleView } from './crm-stock-push.domain';

import { BadRequestException, Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { StockPushScheduler } from '../../telegram/queue/services/stock-push.scheduler';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import {
  INVALID_INTERVAL,
  INVALID_INTERVAL_TEXT,
  parseInterval,
  toCrmPushSchedule,
} from './crm-stock-push.domain';

/**
 * Синхронизация остатков по расписанию — частота от продавца
 * (`stock_push_interval_by_seller`). Уровень продавца, не магазина: проход
 * пишет все площадки и магазины разом. Под `stock_push_schedule` — её
 * по-прежнему открывает администратор; частоту и «выключить» выбирает продавец.
 */
@Controller('crm/ym/stock-push/schedule')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.STOCK_PUSH_SCHEDULE)
export class CrmStockPushScheduleController {
  constructor(private readonly scheduler: StockPushScheduler) {}

  @Get()
  async get(@Req() request: IRequestWithCrmUser): Promise<ICrmPushScheduleView> {
    return toCrmPushSchedule(await this.scheduler.statusFor(request.crmUser.telegramUserId));
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
    const status = await this.scheduler.setInterval(request.crmUser.telegramUserId, interval);
    return toCrmPushSchedule(status);
  }
}
