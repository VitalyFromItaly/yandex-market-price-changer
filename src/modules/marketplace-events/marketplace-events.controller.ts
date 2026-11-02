import type { Request, Response } from 'express';

import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';

import { MarketplaceEventsService } from './marketplace-events.service';

/**
 * `POST /api/webhooks/{ym|ozon}/<секрет>` — уведомления площадок о заказах
 * (`stock_push_on_marketplace_event`). Без CRM-сессии: зовёт площадка, продавца
 * определяет секрет адреса (подписи у ЯМ и Ozon нет). Только доставка — решение
 * в `MarketplaceEventsService`.
 */
@Controller('webhooks')
export class MarketplaceEventsController {
  constructor(private readonly events: MarketplaceEventsService) {}

  @Post(':marketplace/:secret')
  @HttpCode(200)
  async receive(
    @Param('marketplace') marketplace: string,
    @Param('secret') secret: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    // `trust proxy 1` (main.ts): req.ip — адрес клиента из X-Forwarded-For nginx.
    const reply = await this.events.receive(marketplace, secret, body, request.ip);
    response.status(reply.status);
    return reply.body;
  }
}
