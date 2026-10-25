import type { ICrmOzonConnectionView } from './crm-ozon.domain';

import {
  BadRequestException,
  Body,
  Controller,
  Put,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';

import { connectionsView } from '../../marketplaces/marketplace-connections.domain';
import { parseOzonCredentials } from '../../ozon/ozon-connection.domain';
import { OzonConnectionService } from '../../ozon/ozon-connection.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { AllowWithoutPlatform, RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import {
  INVALID_OZON_KEY,
  OZON_KEY_EMPTY,
  OZON_KEY_EMPTY_TEXT,
  OZON_KEY_REJECTED,
  OZON_UNAVAILABLE,
  OZON_UNAVAILABLE_TEXT,
} from './crm-ozon.domain';

/**
 * Ozon в CRM (TASK-128): сегмент `crm/ozon/*` (решение
 * `crm_marketplace_api_segment`), фича `ozon` на классе.
 *
 * `PUT connection` — подключение ключа с проверкой у Ozon ДО записи: формат →
 * 400 под полем, отказ Ozon → 400, ключ без ролей → 400, Ozon недоступен → 503.
 * Во всех отказах база не тронута, рабочий ключ остаётся рабочим.
 */
@Controller('crm/ozon')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.OZON)
export class CrmOzonController {
  constructor(private readonly ozon: OzonConnectionService) {}

  @Put('connection')
  @AllowWithoutPlatform()
  async connect(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmOzonConnectionView> {
    const parsed = parseOzonCredentials(body);
    if (parsed.ok === false) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_OZON_KEY,
        field: parsed.field,
        message: parsed.message,
      });
    }

    const { telegramUserId } = request.crmUser;
    const result = await this.ozon.connect(telegramUserId, parsed.credentials, {
      telegramUserId,
      source: 'crm',
      context: 'crm-ozon:connect',
    });

    if (result.ok === true) {
      // Вид площадки — та же функция, что у GET /marketplaces: две сборки
      // одной строки разошлись бы. available — да: фича открыта, иначе гвард
      // сюда не пустил бы.
      const [connection] = connectionsView(null, [result.connection], ['ozon']).filter(
        (view) => view.key === 'ozon',
      );
      return { connection };
    }
    if (result.reason === 'auth') {
      throw new BadRequestException({
        statusCode: 400,
        code: OZON_KEY_REJECTED,
        field: 'apiKey',
        message: result.message,
      });
    }
    if (result.reason === 'empty') {
      throw new BadRequestException({
        statusCode: 400,
        code: OZON_KEY_EMPTY,
        field: 'apiKey',
        message: OZON_KEY_EMPTY_TEXT,
      });
    }
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: OZON_UNAVAILABLE,
      message: OZON_UNAVAILABLE_TEXT,
    });
  }
}
