import { Request, Response } from 'express';
import { UserService } from '../services/UserService';

export class UserController {
  constructor(private userService: UserService) {}

  // Регистрация нового пользователя
  register = async (req: Request, res: Response) => {
    try {
      const { username, email, password } = req.body;

      if (!username || !email || !password) {
        res.status(400).json({
          success: false,
          message: 'Username, email and password are required'
        });
        return;
      }

      // Проверка формата email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
        return;
      }

      // Проверка существования пользователя
      const existingUser = await this.userService.findByUsernameOrEmail(username, email);
      if (existingUser) {
        res.status(409).json({
          success: false,
          message: 'User with this username or email already exists'
        });
        return;
      }

      // Создание пользователя
      const user = await this.userService.createUser(username, email, password);

      // Генерация API токена
      // @ts-ignore
      const token = await this.userService.generateToken(user._id);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          apiToken: token
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to register user',
        error: error.message
      });
    }
  }

  // Получение API токена (авторизация)
  login = async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
        return;
      }

      // Проверка учетных данных
      const user = await this.userService.validateCredentials(email, password);
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
        return;
      }

      // Генерация API токена
      // @ts-ignore
      const token = await this.userService.generateToken(user._id);

      res.json({
        success: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          apiToken: token
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to login',
        error: error.message
      });
    }
  }

  // Получение профиля пользователя
  getProfile = async (req: Request, res: Response) => {
    try {
      // userId добавляется в req middleware аутентификации
      // @ts-ignore
      const userId = req.userId;

      const user = await this.userService.getUserById(userId);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      res.json({
        success: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get user profile',
        error: error.message
      });
    }
  }

  // Обновление токена API
  refreshToken = async (req: Request, res: Response) => {
    try {
      // @ts-ignore
      const userId = req.userId;

      const token = await this.userService.generateToken(userId);

      res.json({
        success: true,
        apiToken: token
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to refresh token',
        error: error.message
      });
    }
  }
}
