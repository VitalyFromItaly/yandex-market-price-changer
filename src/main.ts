import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { LoggerInterceptor } from './common/interceptors/logger.interceptor';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  // `import 'dotenv/config'` здесь больше не нужен: загрузку и валидацию
  // окружения выполняет ConfigModule внутри AppModule. При отсутствии
  // обязательной переменной приложение упадёт здесь же, на create(), с
  // перечислением сразу всех недостающих ключей.
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('/api');
  app.useGlobalInterceptors(new LoggerInterceptor());

  // Без этого SIGTERM убивает процесс мимо onApplicationShutdown, и в режиме
  // polling цикл getUpdates не останавливается: новый контейнер при редеплое
  // получает 409 Conflict от Bot API — второго читателя апдейтов Telegram не
  // допускает.
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  await app.listen(config.port);
}

// Промис старта нужно дожидаться: без обработчика падение bootstrap (не
// поднялась Mongo, занят порт, не прошла валидация окружения) превращается в
// unhandled rejection — процесс умирает со стеком изнутри Node вместо внятной
// причины и с непредсказуемым кодом выхода.
bootstrap().catch((error) => {
  // eslint-disable-next-line no-console -- логгер Nest на этом этапе может быть ещё не поднят
  console.error('Не удалось запустить приложение:', error);
  process.exit(1);
});
