import { Router } from 'express';
import { BotsModel } from '../../../database/mongo';

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

export default router;
