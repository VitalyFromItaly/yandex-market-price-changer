import type { IHelpModel } from '../../telegram/bots/price-changer-bot/help.model';

import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { PurchasePriceService } from '../../../database/services/purchase-price.service';
import { UserAccessService } from '../../../database/services/user-access.service';
import { YandexMarketService } from '../../../database/services/yandex-market.service';
import { helpModel } from '../../telegram/bots/price-changer-bot/help.text';
import { profileView } from '../../telegram/bots/price-changer-bot/profile.text';
import { resolveAccount } from '../crm-auth.domain';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';

import { ICrmProfile, toCrmProfile } from './crm-profile.domain';

/**
 * «Профиль» и «Помощь» CRM: /api/crm/profile и /api/crm/help.
 *
 * Оба экрана строятся из тех же функций, что экраны бота: профиль — из
 * `profileView` (её же вызывают «📊 Мой профиль» и `/profile`), справка — из
 * `helpModel` (из неё бот рендерит `/help`). Своего текста у CRM нет, и
 * разойтись с ботом ей нечем.
 *
 * Отдельный адрес, а не расширение `/auth/me`: тот перечитывается при каждом
 * возврате во вкладку, а профилю нужны ещё запрос в прайс и запись доступа.
 */
@Controller('crm')
@UseGuards(CrmJwtGuard)
export class CrmProfileController {
  constructor(
    private readonly access: UserAccessService,
    private readonly stores: YandexMarketService,
    private readonly purchasePrices: PurchasePriceService,
  ) {}

  @Get('profile')
  async profile(@Req() request: IRequestWithCrmUser): Promise<ICrmProfile> {
    const user = request.crmUser;
    const [rows, store, priceListUpdatedAt] = await Promise.all([
      this.access.findByLogin(user.telegramUserId),
      this.stores.findByTelegramUser(user.telegramUserId),
      this.purchasePrices.lastUpdatedAt(user.telegramUserId),
    ]);
    const account = resolveAccount(rows, user.telegramUserId);
    const access = account.kind === 'found' ? account.access : null;

    return toCrmProfile(
      profileView({
        telegramUserId: user.telegramUserId,
        firstName: access?.firstName,
        lastName: access?.lastName,
        username: access?.username,
        isAdmin: user.isAdmin,
        access,
        store,
        priceListUpdatedAt,
        // У админа тут уже allFeaturesEnabled() из verify — как в /auth/me.
        features: user.features,
      }),
    );
  }

  @Get('help')
  help(): IHelpModel {
    return helpModel();
  }
}
