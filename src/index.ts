import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { connectDB } from './database/mongo';
import { createApiRoutes } from './routes';
import { authMiddleware } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.handler';
import { UserService } from './services/UserService';
import { BotController } from './controllers/BotController';
import { UserController } from './controllers/UserController';
import { adminAuthMiddleware } from './middleware/admin.middleware';
import { botFather } from './telegram';
import runCron from './cron';


// Расширение dayjs
dayjs.extend(utc);
dayjs.extend(timezone);

// Порт для сервера
const PORT = process.env.PORT ?? 3000;

// Создаем экземпляры контроллеров

// Создаем Express приложение
const app = express();

// Настраиваем middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Добавляем middleware для инициализации пользовательского контекста
// const initUserContext = userContextMiddleware(userService);

// Публичные маршруты (без аутентификации)
app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

// // Маршруты для пользователей (регистрация, получение токена и т.д.)
// const userRoutes = createUserRoutes(userController, initUserContext);
// app.use('/api/users', userRoutes);
//
// // Админские маршруты с особой аутентификацией
// const adminRoutes = createAdminRoutes(botManager, configService, userService);
// app.use('/api/admin', adminAuthMiddleware, initUserContext, adminRoutes);

// // API маршруты, требующие аутентификацию
const apiRoutes = createApiRoutes();
app.use('/api', authMiddleware, apiRoutes);

// Обработка ошибок
app.use(errorHandler);

// Обработчики сигналов завершения
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT signal. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM signal. Shutting down gracefully...');
  process.exit(0);
});

// Основная функция запуска приложения
async function bootstrap() {
  try {
    // Подключаемся к БД
    await connectDB();
    console.log('Connected to MongoDB');

    // Инициализируем телеграм-бота
    await botFather.boot();
    console.log('Telegram bots initialized');

    // Запускаем cron задачи
    runCron();
    console.log('Cron jobs started');

    // Запускаем HTTP сервер
    app.listen(PORT, () => {
      console.log(`Server is running on Port ${PORT}`);
    });

  } catch (error) {
    console.error('Application startup error:', error);
    process.exit(1);
  }
}

// Запуск приложения
bootstrap();
