import type { NestExpressApplication } from '@nestjs/platform-express';

import { NestFactory } from '@nestjs/core';
import { join } from 'path';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggerInterceptor } from './common/interceptors/logger.interceptor';
import { AppConfigService } from './config/app-config.service';
import { ErrorReporter } from './modules/errors/error-reporter.service';

async function bootstrap() {
  // `import 'dotenv/config'` здесь больше не нужен: загрузку и валидацию
  // окружения выполняет ConfigModule внутри AppModule. При отсутствии
  // обязательной переменной приложение упадёт здесь же, на create(), с
  // перечислением сразу всех недостающих ключей.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  /*
   * Админ-панель (web/) раздаётся тем же приложением: одна репа, одна сборка,
   * один контейнер. Конфликта с API нет — тот весь под префиксом /api, а
   * панель живёт в корне.
   *
   * Путь одинаково верен в обоих режимах: в проде __dirname это /app/dist,
   * в разработке через ts-node — <репозиторий>/src.
   *
   * Статику отдаёт middleware express ДО роутера Nest, поэтому LoggerInterceptor
   * на неё не срабатывает и логи не засоряются строкой на каждый файл.
   */
  app.useStaticAssets(join(__dirname, '..', 'web', 'dist'));

  app.setGlobalPrefix('/api');
  app.useGlobalInterceptors(new LoggerInterceptor());

  // Ловитель ошибок достаётся из контейнера: он нужен и фильтру, и
  // обработчикам падений процесса ниже.
  const reporter = app.get(ErrorReporter);
  app.useGlobalFilters(new AllExceptionsFilter(reporter));
  catchProcessFailures(reporter);

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
/**
 * Падения вне запроса: отклонённый промис, до которого никто не добрался, и
 * исключение, вылетевшее из колбэка.
 *
 * Раньше их не ловил никто. unhandledRejection в Node 22 по умолчанию РОНЯЕТ
 * процесс — то есть бот молча перезапускался, и причина оставалась только в
 * логах контейнера, которые CapRover теряет при рестарте.
 *
 * uncaughtException оставлять «в работе» нельзя: состояние процесса после него
 * неизвестно. Записываем, даём ловителю время дописать и выходим — CapRover
 * поднимет контейнер заново.
 */
function catchProcessFailures(reporter: ErrorReporter): void {
  process.on('unhandledRejection', (reason) => {
    void reporter.report({ error: reason, source: 'process', context: 'unhandledRejection' });
  });

  process.on('uncaughtException', (error) => {
    void reporter
      .report({ error, source: 'process', context: 'uncaughtException' })
      .finally(() => process.exit(1));
  });
}

bootstrap().catch((error) => {
  console.error('Не удалось запустить приложение:', error);
  process.exit(1);
});
