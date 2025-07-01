import { Router } from 'express';
import { BotsModel } from '../../../database/mongo';
import { botFather } from '../index';

export function createTelegramRoutes() {
  const router = Router();

  router.post('/bots/create', async (req, res) => {
    const { token, type, name, status, description } = req.body;
    const botByToken = await BotsModel.findOne({ token });
    if (botByToken) {
      res.json({ error: 'bot with this token already exists' });
      return;
    }

    const bot = await BotsModel.create({
      token,
      type,
      name,
      status,
      description,
    });

    res.json(bot);
  });

  router.post('/webhooks/:type/:id', async (req, res) => {
    const { id, type } = req.params;
    const bot = botFather.findBot({ id, type });

    if (!bot) {
      res.sendStatus(404);
      return;
    }

    console.log(`Webhook for ${type} with id ${id}`);
    try {
      await bot.handleUpdate(req.body, res);
    }
    catch (error) {
      console.error('Error handling webhook:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
