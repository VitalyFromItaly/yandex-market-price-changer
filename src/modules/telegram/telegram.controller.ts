import { Controller, Post, Body, Param, Res } from '@nestjs/common';
import { Response } from 'express';

import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post('bots/create')
  async createBot(
    @Body()
    body: {
      token: string;
      type: string;
      name: string;
      status?: string;
      description?: string;
    },
  ) {
    return this.telegramService.createBot(body);
  }

  @Post('webhooks/:type/:id')
  async handleWebhook(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    return this.telegramService.handleWebhook(type, id, body, res);
  }
}
