import type { TLinkOutcome } from '../../products/product-match.service';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ActionLogService } from '../../../database/services/action-log.service';
import { isBrandFilter } from '../../products/product-catalog.domain';
import { ProductCatalogService } from '../../products/product-catalog.service';
import {
  LINK_REFUSAL_TEXT,
  PRODUCT_LINK_KIND,
  ProductMatchService,
} from '../../products/product-match.service';
import { isMarketplace } from '../../products/product.domain';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { bodyObject } from '../expenses/crm-expenses.domain';

import {
  CRM_PRODUCT_CURRENCIES,
  INVALID_LINK,
  INVALID_PURCHASE,
  PRODUCT_NOT_FOUND,
  PRODUCT_PURCHASE_KIND,
  toCrmUnmatched,
} from './crm-products.domain';

/** Строка очереди на страницу: таблица, а не выгрузка. */
const UNMATCHED_PAGE = 50;

/**
 * «Товары» CRM (TASK-118): полный адрес — /api/crm/ym/products. Раздел аккаунта
 * (товар один на все магазины и площадки), целиком под фичей `products`.
 *
 *  - `GET /` — список: `q`, `brand`, `page`, `limit`; опции бренда в ответе;
 *  - `GET /unmatched` — очередь «не сопоставлено» продавца;
 *  - `GET /:id` — карточка: закуп, себестоимость, история, привязки;
 *  - `PUT /:id/purchase` — ручная правка закупа (история `manual` с автором);
 *  - `POST /:id/links`, `DELETE /:id/links/:marketplace` — ручная привязка.
 *
 * Правила привязки — `ProductMatchService`, тот же, что у админки: копия
 * разошлась бы. Продавец и автор — из токена, никогда из тела.
 */
@Controller('crm/ym/products')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.PRODUCTS)
export class CrmProductsController {
  constructor(
    private readonly catalog: ProductCatalogService,
    private readonly matching: ProductMatchService,
    private readonly actionLog: ActionLogService,
  ) {}

  @Get()
  async list(
    @Req() request: IRequestWithCrmUser,
    @Query('q') q?: string,
    @Query('brand') brand?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const view = await this.catalog.list(request.crmUser.telegramUserId, {
      q: typeof q === 'string' ? q.slice(0, 200) : undefined,
      brand: isBrandFilter(brand) ? brand : null,
      page,
      limit,
    });
    return { ...view, currencies: CRM_PRODUCT_CURRENCIES };
  }

  @Get('unmatched')
  async unmatched(
    @Req() request: IRequestWithCrmUser,
    @Query('marketplace') marketplace?: string,
    @Query('page') page?: string,
  ) {
    const current = Math.max(1, Math.trunc(Number(page)) || 1);
    const { items, total } = await this.matching.unmatched({
      telegramUserId: request.crmUser.telegramUserId,
      marketplace: isMarketplace(marketplace) ? marketplace : undefined,
      limit: UNMATCHED_PAGE,
      skip: (current - 1) * UNMATCHED_PAGE,
    });
    return { total, page: current, limit: UNMATCHED_PAGE, items: items.map(toCrmUnmatched) };
  }

  @Get(':id')
  async card(@Req() request: IRequestWithCrmUser, @Param('id') id: string) {
    const card = await this.catalog.card(request.crmUser.telegramUserId, id);
    if (!card) throw notFound();
    return { ...card, currencies: CRM_PRODUCT_CURRENCIES };
  }

  @Put(':id/purchase')
  async updatePurchase(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const uid = request.crmUser.telegramUserId;
    const outcome = await this.catalog.updatePurchase(uid, id, bodyObject(body), uid);

    if (outcome.ok === false) {
      if (outcome.code === 'PRODUCT_NOT_FOUND') throw notFound();
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_PURCHASE,
        field: outcome.field,
        message: outcome.message,
      });
    }

    if (outcome.written) {
      const { purchase, internalSku } = outcome.card;
      void this.actionLog.record({
        telegramUserId: uid,
        botId: 'crm',
        source: 'crm',
        kind: PRODUCT_PURCHASE_KIND,
        action:
          `Ручная правка закупа ${internalSku}: ${purchase?.price ?? '—'} ${purchase?.currency ?? ''}` +
          ` (записей истории ${outcome.written})`,
        context: `crm:${uid}`,
      });
    }
    return { ...outcome.card, currencies: CRM_PRODUCT_CURRENCIES };
  }

  @Post(':id/links')
  @HttpCode(HttpStatus.OK)
  async link(@Req() request: IRequestWithCrmUser, @Param('id') id: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const sku = typeof input.sku === 'string' ? input.sku.trim() : '';
    if (!isMarketplace(input.marketplace) || !sku) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_LINK,
        field: sku ? 'marketplace' : 'sku',
        message: sku ? 'Площадка: ym, ozon или wb' : 'Укажите артикул карточки',
      });
    }

    const uid = request.crmUser.telegramUserId;
    const outcome = await this.matching.link(uid, id, input.marketplace, sku);
    return await this.answer(request, outcome, 'привязка');
  }

  @Delete(':id/links/:marketplace')
  async unlink(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
    @Param('marketplace') marketplace: string,
  ) {
    if (!isMarketplace(marketplace)) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_LINK,
        field: 'marketplace',
        message: 'Площадка: ym, ozon или wb',
      });
    }
    const outcome = await this.matching.unlink(request.crmUser.telegramUserId, id, marketplace);
    return await this.answer(request, outcome, 'отвязка');
  }

  /** Отказ — код и текст админки; успех — строка журнала и свежая карточка. */
  private async answer(request: IRequestWithCrmUser, outcome: TLinkOutcome, action: string) {
    if (outcome.ok === false) {
      const body = { statusCode: 0, code: outcome.code, message: LINK_REFUSAL_TEXT[outcome.code] };
      if (outcome.code === 'PRODUCT_NOT_FOUND')
        throw new NotFoundException({ ...body, statusCode: 404 });
      throw new ConflictException({ ...body, statusCode: 409 });
    }

    const uid = request.crmUser.telegramUserId;
    const moved = outcome.movedFrom ? `, снята с товара ${outcome.movedFrom}` : '';
    void this.actionLog.record({
      telegramUserId: uid,
      botId: 'crm',
      source: 'crm',
      kind: PRODUCT_LINK_KIND,
      action:
        `Ручная ${action} карточки ${outcome.marketplace}:${outcome.sku} ` +
        `и товара ${outcome.productId}${moved} — продавец в CRM`,
      context: `crm:${uid}`,
    });

    const card = await this.catalog.card(uid, outcome.productId);
    if (!card) throw notFound();
    return { ...card, currencies: CRM_PRODUCT_CURRENCIES };
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: PRODUCT_NOT_FOUND,
    message: LINK_REFUSAL_TEXT.PRODUCT_NOT_FOUND,
  });
}
