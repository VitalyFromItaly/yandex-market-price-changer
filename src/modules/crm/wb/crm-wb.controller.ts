import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Put,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';

import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { parseWbToken } from '../../wb/wb-connection.domain';
import { WbConnectionService } from '../../wb/wb-connection.service';
import { AllowWithoutPlatform, RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import {
  INVALID_WB_TOKEN,
  WB_TOKEN_REJECTED,
  WB_TOKEN_SCOPES,
  WB_UNAVAILABLE,
  WB_UNAVAILABLE_TEXT,
} from './crm-wb.domain';

/**
 * Wildberries в CRM (TASK-133): сегмент `crm/wb/*` (решение
 * `crm_marketplace_api_segment`), фича `wb` на классе.
 *
 * `PUT connection` — подключение токена с проверкой у WB ДО записи: формат и
 * срок → 400 под полем, отказ WB → 400, нет нужных категорий → 400 с перечнем,
 * WB недоступен → 503. Во всех отказах база не тронута. Успех — 200 без тела:
 * экран «Подключений» после замены перечитывает карточки сам.
 */
@Controller('crm/wb')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.WB)
export class CrmWbController {
  constructor(private readonly wb: WbConnectionService) {}

  @Put('connection')
  @AllowWithoutPlatform()
  @HttpCode(200)
  async connect(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<{ connected: true }> {
    const parsed = parseWbToken(body);
    if (parsed.ok === false) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_WB_TOKEN,
        field: 'token',
        message: parsed.message,
      });
    }

    const { telegramUserId } = request.crmUser;
    const result = await this.wb.connect(telegramUserId, parsed.token, {
      telegramUserId,
      source: 'crm',
      context: 'crm-wb:connect',
    });

    if (result.ok === true) return { connected: true };
    if (result.reason === 'auth' || result.reason === 'scopes') {
      throw new BadRequestException({
        statusCode: 400,
        code: result.reason === 'auth' ? WB_TOKEN_REJECTED : WB_TOKEN_SCOPES,
        field: 'token',
        message: result.message,
      });
    }
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: WB_UNAVAILABLE,
      message: WB_UNAVAILABLE_TEXT,
    });
  }
}
