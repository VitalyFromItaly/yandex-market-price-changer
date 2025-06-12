import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { authMiddleware } from '../middleware/auth.middleware';

export const createUserRoutes = (userController: UserController, initUserContext) => {
  const router = Router();

  // Публичные маршруты (без аутентификации)
  router.post('/register', userController.register);
  router.post('/login', userController.login);

  // Защищенные маршруты (требуют аутентификацию)
  router.get('/profile', authMiddleware, initUserContext, userController.getProfile);
  router.post('/refresh-token', authMiddleware, initUserContext, userController.refreshToken);

  return router;
};
