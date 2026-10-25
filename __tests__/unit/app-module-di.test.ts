import net from 'node:net';

import { Test } from '@nestjs/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Полный граф DI AppModule (TASK-177).
 *
 * 2026-10-20 прод не стартовал: CrmAiAnalystModule не импортировал DatabaseModule
 * (AiTurnService), а HTTP-тесты подставляют @Global() FakeDatabaseModule — им такая
 * дыра не видна. Здесь компилируется НАСТОЯЩИЙ AppModule: любая неразрешённая
 * зависимость — UnknownDependenciesException, как на старте прода.
 *
 * `compile()` создаёт провайдеры, но не зовёт onModuleInit/onApplicationBootstrap:
 * BotRegistry вебхук не трогает, миграции Postgres не запускаются. `close()` не
 * зовётся по той же причине — хуки остановки ботов ходили бы в Telegram.
 */

/**
 * Окружение — до импорта AppModule: ConfigModule валидирует его при сборке. Явные
 * значения перекрывают локальный .env (dotenv не перезаписывает process.env), и
 * все адреса — loopback-порты, где никого нет.
 */
const ENV: Record<string, string> = {
  NODE_ENV: 'test',
  STOCK_WRITE_ENABLED: 'false',
  MONGODB_URL: 'mongodb://127.0.0.1:1/',
  MONGODB_DATABASE: 'di-test',
  POSTGRES_URL: 'postgres://di:di@127.0.0.1:1/di',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '1',
  TELEGRAM_TOKEN: '1:di-test',
  TELEGRAM_ADMIN_IDS: '1',
  TELEGRAM_UPDATE_MODE: 'polling',
  POLZA_AI_TOKEN: '',
};

describe('AppModule: граф DI', () => {
  const saved = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('собирается целиком и без сети', async () => {
    Object.assign(process.env, ENV);
    const connect = vi.spyOn(net.Socket.prototype, 'connect');

    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // Bull открывает Redis сразу в конструкторе очереди (Mongo и Postgres ленивые) —
    // это допустимо, пока адрес loopback: в CI там отказ, наружу не уходит ничего.
    // net.connect зовёт Socket#connect с нормализованным массивом `[options, cb]`.
    const hosts = connect.mock.calls.map(([first]) => {
      const options = (Array.isArray(first) ? first[0] : first) as net.TcpNetConnectOpts;
      return options.host;
    });
    connect.mockRestore();
    expect(moduleRef).toBeDefined();
    expect(hosts.filter((host) => host !== '127.0.0.1')).toEqual([]);
  }, 60_000);
});
