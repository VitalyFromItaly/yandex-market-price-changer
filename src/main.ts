import type { NestExpressApplication } from '@nestjs/platform-express';

import { NestFactory } from '@nestjs/core';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'net';
import { join } from 'path';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggerInterceptor } from './common/interceptors/logger.interceptor';
import { AppConfigService } from './config/app-config.service';
import { ErrorReporter } from './modules/errors/error-reporter.service';

/*
 * Node ≥20 соединяется по «happy eyeballs»: перебирает IPv6/IPv4-адреса хоста
 * и даёт каждой попытке 250 мс. У api.partner.market.yandex.ru есть AAAA, а
 * IPv6 бывает недоступен (ENETUNREACH); если IPv4-рукопожатие дольше 250 мс
 * (замер 25-09-2026: ~280 мс), падают ОБЕ попытки — ETIMEDOUT с пустым текстом,
 * хотя curl в тот же миг получает ответ. Выглядело как «Яндекс лежит» то на
 * минуту, то на час. Две секунды на попытку — запас, а не ожидание: успешное
 * соединение не ждёт таймаута. Ставится до создания приложения — до первого
 * сокета; axios, fetch (undici) и telegraf ходят через net.
 */
setDefaultAutoSelectFamilyAttemptTimeout(2000);

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
  /*
   * CRM продавца (crm/) — второй SPA, под префиксом /crm, и регистрируется
   * РАНЬШЕ корневой админки: express-static отдаёт первый найденный файл, а
   * у обеих сборок есть index.html и favicon.svg. Vite собирает её с base
   * '/crm/', роутер — на hash, поэтому SPA-fallback не нужен: F5 на
   * /crm/#/ym/orders запрашивает только /crm/.
   */
  app.useStaticAssets(join(__dirname, '..', 'crm', 'dist'), { prefix: '/crm' });
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
