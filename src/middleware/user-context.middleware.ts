import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/UserService';

export const userContextMiddleware = (userService: UserService) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    // @ts-ignore
    if (req.user?.id) {
      try {
        // Добавляем пользовательский контекст в request
        // @ts-ignore
        // req.userContext = userService.getContext(req.user.id);
        next();
      } catch (error) {
        console.error('Error initializing user context:', error);
        next(error);
      }
    } else {
      next();
    }
  };
};
