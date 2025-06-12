import { Router } from 'express';
import telegramWebhooksController from './controllers/webhooks.controller';
import botController from './controllers/bot.controller';

// @todo переделать, перенес в routes.ts
const api = Router()
  .use(telegramWebhooksController)
  .use(botController)

export default Router().use('/telegram', api);
