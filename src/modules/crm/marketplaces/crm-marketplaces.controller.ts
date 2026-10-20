import type { IMarketplaceConnectionView } from '../../marketplaces/marketplace-connections.domain';

import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { MarketplaceConnectionsService } from '../../marketplaces/marketplace-connections.service';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

export interface ICrmMarketplacesView {
  marketplaces: IMarketplaceConnectionView[];
}

/**
 * Площадки продавца: GET /api/crm/marketplaces (TASK-127). По нему CRM строит
 * переключатель площадок и «подключена / скоро».
 *
 * Контроллеры площадок остаются каждый под своим сегментом — `crm/ym/*`, у
 * Ozon и WB будут `crm/ozon/*`, `crm/wb/*` (решение `crm_marketplace_api_segment`):
 * формы их данных разные, и общий `crm/:mp` заставил бы каждый контроллер ЯМ
 * отсекать чужие площадки в рантайме.
 *
 * Фичи у списка нет: это навигация, а не функция — как список «Магазины».
 * Фичи площадок (`ozon`, TASK-128) решают только `available`: закрытая — «скоро».
 *
 * Отдельный адрес, а не поле `/auth/me`: тот перечитывается при каждом
 * возврате во вкладку, а здесь — два запроса в Mongo.
 */
@Controller('crm/marketplaces')
@UseGuards(CrmJwtGuard)
export class CrmMarketplacesController {
  constructor(private readonly connections: MarketplaceConnectionsService) {}

  @Get()
  async list(@Req() request: IRequestWithCrmUser): Promise<ICrmMarketplacesView> {
    const { telegramUserId, features } = request.crmUser;
    return { marketplaces: await this.connections.list(telegramUserId, features) };
  }
}
