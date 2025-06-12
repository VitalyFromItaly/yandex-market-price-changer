import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/UserService';

const userService = new UserService();

export const adminAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
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

    // Проверяем права администратора
    // @ts-ignore
    if (!user.isAdmin) {
      res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
      return;
    }

    // Добавляем информацию о пользователе в запрос
    // @ts-ignore
    req.user = user;
    // @ts-ignore
    req.userId = user._id.toString();
    // @ts-ignore
    req.isAdmin = true;

    next();
  } catch (error) {
    console.error('Admin authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};
