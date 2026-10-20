import type { TLinkOutcome } from './product-match.service';
import type { TMarketplace } from './product.domain';

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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ActionLogService } from '../../database/services/action-log.service';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';

import { LINK_REFUSAL_TEXT, PRODUCT_LINK_KIND, ProductMatchService } from './product-match.service';
import { isMarketplace } from './product.domain';

export { PRODUCT_LINK_KIND } from './product-match.service';

/** Число из query: мусор — умолчание, а не NaN в запросе к базе. */
const intOf = (value: string | undefined): number | undefined => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) ? Math.trunc(n) : undefined;
};

/**
 * Сопоставление карточек площадок с товарами для владельца (TASK-117):
 *  - `GET /api/products/unmatched?telegramUserId=&marketplace=&limit=&skip=` —
 *    очередь «не сопоставлено» с причиной словами и кандидатами;
 *  - `POST /api/products/:productId/links {telegramUserId, marketplace, sku}` —
 *    ручная привязка;
 *  - `DELETE /api/products/:productId/links/:marketplace?telegramUserId=` —
 *    ручная отвязка.
 *
 * Гвард на весь контроллер (довод LogsController). Фичи нет (решение
 * `product_matching_no_feature`): функция есть только у админа, у продавца
 * закрывать нечего. Экрана в панели пока нет — раздел «Товары» (TASK-118).
 */
@Controller('products')
@UseGuards(AdminJwtGuard)
export class ProductAdminController {
  constructor(
    private readonly matching: ProductMatchService,
    private readonly actionLog: ActionLogService,
  ) {}

  @Get('unmatched')
  async unmatched(
    @Query('telegramUserId') telegramUserId?: string,
    @Query('marketplace') marketplace?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    if (marketplace && !isMarketplace(marketplace)) {
      throw new BadRequestException('marketplace: ym, ozon или wb');
    }
    return await this.matching.unmatched({
      telegramUserId: telegramUserId || undefined,
      marketplace: (marketplace || undefined) as TMarketplace | undefined,
      limit: intOf(limit),
      skip: intOf(skip),
    });
  }

  /** Автор — из токена (`req.adminId`), не из тела. Одна строка журнала на действие. */
  @Post(':productId/links')
  @HttpCode(HttpStatus.OK)
  async link(
    @Param('productId') productId: string,
    @Body() body: { telegramUserId?: unknown; marketplace?: unknown; sku?: unknown },
    @Req() req: { adminId?: string },
  ) {
    const telegramUserId = requiredString(body?.telegramUserId, 'telegramUserId');
    const sku = requiredString(body?.sku, 'sku');
    if (!isMarketplace(body?.marketplace)) {
      throw new BadRequestException('marketplace: ym, ozon или wb');
    }

    const outcome = await this.matching.link(telegramUserId, productId, body.marketplace, sku);
    return this.answer(outcome, telegramUserId, req.adminId, 'привязка');
  }

  @Delete(':productId/links/:marketplace')
  async unlink(
    @Param('productId') productId: string,
    @Param('marketplace') marketplace: string,
    @Query('telegramUserId') telegramUserId: string | undefined,
    @Req() req: { adminId?: string },
  ) {
    const user = requiredString(telegramUserId, 'telegramUserId');
    if (!isMarketplace(marketplace)) throw new BadRequestException('marketplace: ym, ozon или wb');

    const outcome = await this.matching.unlink(user, productId, marketplace);
    return this.answer(outcome, user, req.adminId, 'отвязка');
  }

  private answer(
    outcome: TLinkOutcome,
    telegramUserId: string,
    adminIdRaw: string | undefined,
    action: string,
  ) {
    // `'code' in`, а не `!outcome.ok`: без strictNullChecks булев литерал союз не сужает.
    if ('code' in outcome) {
      const body = { code: outcome.code, message: LINK_REFUSAL_TEXT[outcome.code] };
      if (outcome.code === 'PRODUCT_HAS_CARD') throw new ConflictException(body);
      throw new NotFoundException(body);
    }

    const adminId = adminIdRaw ?? 'panel';
    const moved = outcome.movedFrom ? `, снята с товара ${outcome.movedFrom}` : '';
    void this.actionLog.record({
      telegramUserId,
      botId: 'panel',
      kind: PRODUCT_LINK_KIND,
      action:
        `Ручная ${action} карточки ${outcome.marketplace}:${outcome.sku} ` +
        `и товара ${outcome.productId}${moved} — администратор ${adminId}`,
      context: `admin:${adminId}`,
    });

    return {
      productId: outcome.productId,
      marketplace: outcome.marketplace,
      sku: outcome.sku,
      movedFrom: outcome.movedFrom,
    };
  }
}

function requiredString(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new BadRequestException(`${field}: обязателен`);
  return text;
}
