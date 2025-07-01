import { Router } from 'express';
import { createTelegramRoutes } from '../modules/telegram/api/routes';

export function createApiRoutes() {
  const router = Router();

  // Телеграм маршруты
  router.use('/telegram', createTelegramRoutes());

  return router;
}
