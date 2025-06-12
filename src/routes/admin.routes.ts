import { Router } from 'express';
import { BotManagerService } from '../services/BotManagerService';
import { ConfigService } from '../services/ConfigService';
import { UserService } from '../services/UserService';

export const createAdminRoutes = (
  botManager: BotManagerService,
  configService: ConfigService,
  userService: UserService
) => {
  const router = Router();

  // Запуск всех ботов с активными конфигурациями
  router.post('/bots/start-all', async (req, res) => {
    try {
      const result = await botManager.startAllActiveBots();

      res.json({
        success: true,
        message: `Started ${result} active bots`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to start all bots',
        error: error.message
      });
    }
  });

  // Остановка всех запущенных ботов
  router.post('/bots/stop-all', async (req, res) => {
    try {
      await botManager.stopAllBots();

      res.json({
        success: true,
        message: 'All bots stopped successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to stop all bots',
        error: error.message
      });
    }
  });

  // Получение списка всех пользователей
  router.get('/users', async (req, res) => {
    try {
      const users = await userService.getAllUsers();

      res.json({
        success: true,
        users: users.map(user => ({
          id: user._id,
          username: user.username,
          email: user.email,
          createdAt: user.createdAt
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get users',
        error: error.message
      });
    }
  });

  // Получение всех конфигураций всех пользователей
  router.get('/configs', async (req, res) => {
    try {
      const allConfigs = await configService.getAllActiveConfigs();

      res.json({
        success: true,
        configs: allConfigs
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get all configurations',
        error: error.message
      });
    }
  });

  return router;
};
