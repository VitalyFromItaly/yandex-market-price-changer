import type { ICrmStoreView, ICrmStoresView, ICrmTokenReplaced } from './crm-stores.domain';
import type { IStoreCallOrigin } from '../../yandex/stores/stores.service';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';

import { validateStep } from '../../telegram/bots/price-changer-bot/onboarding';
import { storeLabel } from '../../telegram/bots/price-changer-bot/store-picker';
import { StoresService } from '../../yandex/stores/stores.service';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { NO_STORE, NO_STORE_TEXT } from '../settings/crm-settings.domain';

import {
  INVALID_TOKEN,
  MARKET_UNAVAILABLE,
  MARKET_UNAVAILABLE_TEXT,
  STORE_NOT_FOUND,
  STORE_NOT_FOUND_TEXT,
  TOKEN_EMPTY,
  TOKEN_EMPTY_TEXT,
  TOKEN_REJECTED,
  parseTokenBody,
  toStoreItems,
  toStoreView,
} from './crm-stores.domain';

/**
 * «Магазины» CRM: /api/crm/ym/stores.
 *
 * Веб не переключает активный магазин бота — магазин открывается по ключу из
 * URL, и отчёты внутри считаются по нему (`StoresService.resolve`). Раздел не
 * гейтится: без него продавец не попадёт ни в один отчёт.
 */
@Controller('crm/ym/stores')
@UseGuards(CrmJwtGuard)
export class CrmStoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  async list(@Req() request: IRequestWithCrmUser): Promise<ICrmStoresView> {
    const telegramUserId = request.crmUser.telegramUserId;
    const cached = await this.stores.cachedStores(telegramUserId, originOf(telegramUserId, 'list'));
    if (!cached) throw noStore();
    return { stores: toStoreItems(cached.stores) };
  }

  /**
   * Смена токена — после проверки по Маркету. Отказ, недоступность и пустой
   * список ничего не пишут: прежний токен остаётся (онбординга в CRM нет, и
   * «сломать» подключение из веба нельзя).
   *
   * Объявлен ДО `:key`, иначе `token` разобрался бы как ключ магазина.
   */
  @Put('token')
  async replaceToken(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmTokenReplaced> {
    const telegramUserId = request.crmUser.telegramUserId;
    const token = parseTokenBody(body);

    const format = validateStep('token', token);
    if (!format.ok) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_TOKEN,
        message: format.error,
      });
    }

    const result = await this.stores.replaceToken(
      telegramUserId,
      token,
      originOf(telegramUserId, 'token'),
    );
    if (result.ok === true) {
      return {
        stores: toStoreItems(result.stores),
        botStore: result.botStore ? storeLabel(result.botStore) : null,
      };
    }

    switch (result.reason) {
      case 'auth':
        throw new BadRequestException({
          statusCode: 400,
          code: TOKEN_REJECTED,
          message: result.message,
        });
      case 'empty':
        throw new BadRequestException({
          statusCode: 400,
          code: TOKEN_EMPTY,
          message: TOKEN_EMPTY_TEXT,
        });
      case 'unavailable':
        throw new ServiceUnavailableException({
          statusCode: 503,
          code: MARKET_UNAVAILABLE,
          message: MARKET_UNAVAILABLE_TEXT,
        });
      default:
        throw noStore();
    }
  }

  @Get(':key')
  async view(
    @Req() request: IRequestWithCrmUser,
    @Param('key') key: string,
  ): Promise<ICrmStoreView> {
    const user = request.crmUser;
    const resolved = await this.stores.resolve(
      user.telegramUserId,
      key,
      originOf(user.telegramUserId, 'view'),
    );
    if (!resolved) {
      throw new NotFoundException({
        statusCode: 404,
        code: STORE_NOT_FOUND,
        message: STORE_NOT_FOUND_TEXT,
      });
    }
    return toStoreView(resolved.stores, resolved.entry, user.features);
  }
}

function originOf(telegramUserId: string, action: string): IStoreCallOrigin {
  return { telegramUserId, source: 'crm', context: `crm-stores:${action}` };
}

function noStore(): ConflictException {
  return new ConflictException({ statusCode: 409, code: NO_STORE, message: NO_STORE_TEXT });
}
