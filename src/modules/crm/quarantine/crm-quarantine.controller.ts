import type { ICrmQuarantineConfirmed, ICrmQuarantineView } from './crm-quarantine.domain';
import type {
  IStoreEntry,
  YandexMarketDocument,
} from '../../../database/schemas/yandex-market.schema';

import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ErrorReporter } from '../../errors/error-reporter.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import {
  QUARANTINE_LOAD_ERROR_PLAIN,
  quarantinePartialText,
} from '../../yandex/quarantine/quarantine-message';
import { QuarantinePartialConfirmError } from '../../yandex/quarantine/quarantine.domain';
import { QuarantineService } from '../../yandex/quarantine/quarantine.service';
import { StoresService } from '../../yandex/stores/stores.service';
import { YandexApiError } from '../../yandex/yandex-api.errors';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { STORE_NOT_FOUND, STORE_NOT_FOUND_TEXT } from '../stores/crm-stores.domain';

import {
  INVALID_OFFERS,
  INVALID_OFFERS_TEXT,
  MARKET_ERROR,
  QUARANTINE_PARTIAL,
  parseOfferIds,
  splitByLive,
  toCrmQuarantineView,
} from './crm-quarantine.domain';

/**
 * «Карантин цен» CRM: /api/crm/ym/quarantine.
 *
 * Чтение и запись — `QuarantineService`, общий с ботом. Магазин — из ключа в
 * адресе (GET — query, POST — тело), активный магазин бота веб не трогает
 * (TASK-079). Карантин бизнесовый: магазин нужен только затем, чтобы знать
 * кабинет и его токен.
 */
@Controller('crm/ym/quarantine')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.PRICE_QUARANTINE)
export class CrmQuarantineController {
  constructor(
    private readonly stores: StoresService,
    private readonly quarantine: QuarantineService,
    private readonly errors: ErrorReporter,
  ) {}

  @Get()
  async list(
    @Req() request: IRequestWithCrmUser,
    @Query('store') storeKey: unknown,
  ): Promise<ICrmQuarantineView> {
    const telegramUserId = request.crmUser.telegramUserId;
    const { store, entry } = await this.resolveStore(telegramUserId, storeKey, 'list');

    try {
      return toCrmQuarantineView(entry.businessName ?? '', await this.quarantine.list(store));
    } catch (error) {
      throw this.marketFailure(error, telegramUserId, 'list', QUARANTINE_LOAD_ERROR_PLAIN);
    }
  }

  /**
   * Подтверждение — ЗАПИСЬ в Partner API. Подтверждается пересечение запроса с
   * живым карантином; после ответа веб перезапрашивает список сам (Маркет
   * убирает подтверждённые).
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Req() request: IRequestWithCrmUser,
    @Body() body: Record<string, unknown>,
  ): Promise<ICrmQuarantineConfirmed> {
    const telegramUserId = request.crmUser.telegramUserId;
    const offerIds = parseOfferIds(body?.offerIds);
    if (!offerIds) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_OFFERS,
        message: INVALID_OFFERS_TEXT,
      });
    }
    const { store } = await this.resolveStore(telegramUserId, body?.store, 'confirm');

    try {
      const { toConfirm, stale } = splitByLive(offerIds, await this.quarantine.list(store));
      const confirmed = await this.quarantine.confirm(store, toConfirm);
      return { confirmed, stale };
    } catch (error) {
      if (error instanceof QuarantinePartialConfirmError) {
        this.report(error.cause, telegramUserId, 'confirm');
        throw new BadGatewayException({
          statusCode: 502,
          code: QUARANTINE_PARTIAL,
          confirmed: error.confirmed,
          requested: error.requested,
          message: quarantinePartialText(error.confirmed, error.requested),
        });
      }
      throw this.marketFailure(error, telegramUserId, 'confirm');
    }
  }

  private async resolveStore(
    telegramUserId: string,
    storeKey: unknown,
    action: string,
  ): Promise<{ store: YandexMarketDocument; entry: IStoreEntry }> {
    if (typeof storeKey !== 'string' || !storeKey) {
      throw new BadRequestException('Не выбран магазин');
    }
    const resolved = await this.stores.resolve(telegramUserId, storeKey, {
      telegramUserId,
      source: 'crm',
      context: `crm-quarantine:${action}`,
    });
    if (!resolved) {
      throw new NotFoundException({
        statusCode: 404,
        code: STORE_NOT_FOUND,
        message: STORE_NOT_FOUND_TEXT,
      });
    }
    return resolved;
  }

  /**
   * Ошибка Маркета — 502 с его `userMessage` (отказ токена, лимит, недоступность
   * читаются продавцу по-разному). Остальное — наверх, в общий фильтр.
   */
  private marketFailure(
    error: unknown,
    telegramUserId: string,
    action: string,
    fallback?: string,
  ): unknown {
    if (!(error instanceof YandexApiError)) return error;
    this.report(error, telegramUserId, action);
    return new BadGatewayException({
      statusCode: 502,
      code: MARKET_ERROR,
      message: error.userMessage || fallback,
    });
  }

  private report(error: unknown, telegramUserId: string, action: string): void {
    void this.errors.report({
      error,
      source: 'crm',
      context: `crm-quarantine:${action}`,
      telegramUserId,
      action: action === 'confirm' ? 'подтверждение цен карантина' : 'карантин цен',
    });
  }
}
