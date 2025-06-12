import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/UserService';

const userService = new UserService();

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Пропускаем запросы к Telegram без авторизации
    if (req.path.startsWith('/telegram')) {
      next();
      return;
    }

    // Извлекаем токен из заголовка Authorization
    // const token = req.headers.authorization?.replace('Bearer ', '');
    const token = req.headers['x-api-key'] as string;

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Ищем пользователя по токену
    const user = await userService.getUserByToken(token);
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid API token'
      });
      return;
    }

    // Добавляем информацию о пользователе в запрос
    //@ts-ignore
    req.user = user;
    //@ts-ignore
    req.userId = user._id.toString();

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};
