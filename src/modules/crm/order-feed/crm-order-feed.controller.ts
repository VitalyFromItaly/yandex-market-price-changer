import type { IOrderDetail } from '../../finance/order-feed.service';

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';

import { MARKETPLACES } from '../../../shared/marketplace';
import { OrderFeedService } from '../../finance/order-feed.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { RequireFeature } from '../crm-auth.decorators';
import { FEATURE_DISABLED } from '../crm-features.domain';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import {
  financeMarketplaceClosedText,
  isFinanceMarketplaceOpen,
} from '../finance/crm-finance.domain';

/** Номер заказа площадки: ЯМ — число, Ozon — `12345-0001-1`, WB — srid. */
const ORDER_ID_RE = /^[\w.-]{1,64}$/;

/**
 * «Лента заказов» (TASK-144): история операций одного заказа. Список — kind
 * фоновых задач `order-feed:list`; деталь — быстрый запрос в Postgres, поэтому
 * обычный GET, открывается при раскрытии заказа.
 */
@Controller('crm/ym/order-feed')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.ORDER_FEED)
export class CrmOrderFeedController {
  constructor(private readonly orderFeed: OrderFeedService) {}

  @Get(':marketplace/:orderId')
  async detail(
    @Req() request: IRequestWithCrmUser,
    @Param('marketplace') marketplace: string,
    @Param('orderId') orderId: string,
  ): Promise<IOrderDetail> {
    const user = request.crmUser;
    const mp = MARKETPLACES.find((key) => key === marketplace);
    if (!mp || !ORDER_ID_RE.test(orderId)) {
      throw new BadRequestException('Неизвестная площадка или номер заказа');
    }
    if (!isFinanceMarketplaceOpen(user.features, mp)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: FEATURE_DISABLED,
        message: financeMarketplaceClosedText(mp),
      });
    }
    return this.orderFeed.detail(user.telegramUserId, mp, orderId);
  }
}
