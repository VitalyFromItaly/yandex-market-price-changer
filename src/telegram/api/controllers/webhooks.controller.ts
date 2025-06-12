import { Express, Router } from 'express';
import { botFather } from '../../index';

const router = Router();

router.post('/webhooks/:type/:id', async (req, res) => {
  const { id, type } = req.params;
  const bot = botFather.findBot({ id, type });

  if (!bot) {
    res.sendStatus(404);
    return;
  }

  console.log(`Webhook for ${type} with id ${id}`);
  await bot.handleUpdate(req.body, res);
});

export default router;
