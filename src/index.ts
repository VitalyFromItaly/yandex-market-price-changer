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
import { botFather } from './modules/telegram';
import { FileUploadService } from './services/file-upload.service';

// Расширение dayjs
dayjs.extend(utc);
dayjs.extend(timezone);

// Порт для сервера
const PORT = process.env.PORT ?? 3000;

// Создаем экземпляры контроллеров

// Создаем Express приложение
const app = express();

// Настраиваем middleware для обработки telegram webhook'ов перед body-parser
// app.use(telegramWebhookMiddleware);

// Настраиваем middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
    await connectDB();
    await FileUploadService.init(); // Инициализируем сервис файлов
    await botFather.boot();

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
