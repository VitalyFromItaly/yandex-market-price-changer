import type { ICrmConnectionCheckView, ICrmConnectionsView } from './crm-connections.domain';

import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { isMarketplace } from '../../../shared/marketplace';
import { marketplaceFeatures } from '../../marketplaces/marketplace-connections.domain';
import { MarketplaceConnectionsService } from '../../marketplaces/marketplace-connections.service';
import { AllowWithoutPlatform } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import {
  NOT_CONNECTED,
  NOT_CONNECTED_TEXT,
  UNKNOWN_MARKETPLACE,
  UNKNOWN_MARKETPLACE_TEXT,
} from './crm-connections.domain';

/**
 * «Подключения» CRM (TASK-161): /api/crm/connections.
 *
 * Класс без фичи: ЯМ — основная площадка, и смена его токена была открыта
 * всем ещё на «Магазинах». Ozon и WB закрыты своими фичами — их карточки
 * без фичи приходят «скоро» (`available: false`), а проверка их ключа
 * проверяет фичу по площадке из адреса тем же `assertFeatures`, что стоит
 * за `@RequireFeature`. Замена ключа живёт на маршрутах площадок
 * (`crm/ym/stores/token`, `crm/ozon/connection`) — здесь только чтение и
 * повторная проверка.
 */
@Controller('crm/connections')
@AllowWithoutPlatform()
@UseGuards(CrmJwtGuard)
export class CrmConnectionsController {
  constructor(
    private readonly connections: MarketplaceConnectionsService,
    private readonly guard: CrmJwtGuard,
  ) {}

  @Get()
  async list(@Req() request: IRequestWithCrmUser): Promise<ICrmConnectionsView> {
    const { telegramUserId, features } = request.crmUser;
    return { connections: await this.connections.cards(telegramUserId, features) };
  }

  /** «Проверить связь»: ключ не меняется ни в одном исходе, ответ — 200 с итогом. */
  @Post(':marketplace/check')
  @HttpCode(200)
  async check(
    @Req() request: IRequestWithCrmUser,
    @Param('marketplace') marketplace: string,
  ): Promise<ICrmConnectionCheckView> {
    if (!isMarketplace(marketplace)) {
      throw new BadRequestException({
        statusCode: 400,
        code: UNKNOWN_MARKETPLACE,
        message: UNKNOWN_MARKETPLACE_TEXT,
      });
    }
    const user = request.crmUser;
    await this.guard.assertFeatures(user, marketplaceFeatures(marketplace));

    const result = await this.connections.check(user.telegramUserId, marketplace, user.features);
    if (!result) {
      throw new NotFoundException({
        statusCode: 404,
        code: NOT_CONNECTED,
        message: NOT_CONNECTED_TEXT,
      });
    }
    return result;
  }
}
