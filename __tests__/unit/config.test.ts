import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from '../../src/config/env.validation';
import { AppConfigService } from '../../src/config/app-config.service';

/** Полный валидный набор — база для сценариев «убрали одну переменную». */
const VALID_ENV = {
  MONGODB_URL: 'mongodb://root:secret@localhost:27018/',
  MONGODB_DATABASE: 'yandex-market-price-changer',
  REDIS_HOST: 'localhost',
  TELEGRAM_TOKEN: '123456:AAbbCC',
  TELEGRAM_WEBHOOK_URL: 'https://example.ngrok-free.app',
  TELEGRAM_ADMIN_IDS: '123456789,987654321',
};

describe('envValidationSchema', () => {
  it('пропускает полный валидный набор', () => {
    const { error } = envValidationSchema.validate(VALID_ENV);
    expect(error).toBeUndefined();
  });

  it.each([
    'MONGODB_URL',
    'MONGODB_DATABASE',
    'REDIS_HOST',
    'TELEGRAM_TOKEN',
    'TELEGRAM_WEBHOOK_URL',
    'TELEGRAM_ADMIN_IDS',
  ])('падает, если не задан %s', (key) => {
    const env = { ...VALID_ENV };
    delete (env as Record<string, string>)[key];
    const { error } = envValidationSchema.validate(env);
    expect(error).toBeDefined();
    expect(error!.message).toContain(key);
  });

  it('сообщает обо ВСЕХ проблемах сразу, а не по одной за запуск', () => {
    const { error } = envValidationSchema.validate(
      { TELEGRAM_TOKEN: 'x', TELEGRAM_WEBHOOK_URL: 'https://a.example.com' },
      { abortEarly: false },
    );
    expect(error).toBeDefined();
    expect(error!.details.length).toBeGreaterThanOrEqual(3);
  });

  it('REDIS_HOST обязателен — без него Bull молча уходит на localhost', () => {
    const env = { ...VALID_ENV };
    delete (env as Record<string, string>).REDIS_HOST;
    const { error } = envValidationSchema.validate(env);
    expect(error!.message).toContain('Bull');
  });

  it('TELEGRAM_WEBHOOK_URL обязан быть полным URL', () => {
    const { error } = envValidationSchema.validate({
      ...VALID_ENV,
      TELEGRAM_WEBHOOK_URL: 'не-урл',
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain('https://');
  });

  it('подставляет значения по умолчанию', () => {
    const { value } = envValidationSchema.validate(VALID_ENV);
    expect(value.PORT).toBe(3000);
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.NODE_ENV).toBe('development');
    expect(value.YANDEX_MARKET_BASE_URL).toBe('https://api.partner.market.yandex.ru');
    // Без зеркала приложение обязано работать напрямую.
    expect(value.TELEGRAM_API_URL).toBe('https://api.telegram.org');
  });

  it('пустой TELEGRAM_API_URL означает «зеркала нет» и подставляет дефолт', () => {
    // В .env.example ключ есть с пустым значением: скопированный шаблон не
    // должен падать на «must be a valid uri».
    const { error, value } = envValidationSchema.validate({
      ...VALID_ENV,
      TELEGRAM_API_URL: '',
    });
    expect(error).toBeUndefined();
    expect(value.TELEGRAM_API_URL).toBe('https://api.telegram.org');
  });

  it.each(['https://tg-api.example.com/tg', 'https://tg-api.example.com/bot/'])(
    'TELEGRAM_API_URL отвергает %o — путь в базовом URL telegraf отбрасывает',
    (value) => {
      // new URL('./bot<token>/method', 'https://h/tg') === 'https://h/bot<token>/method',
      // то есть каждый вызов ушёл бы в 404 молча.
      const { error } = envValidationSchema.validate({ ...VALID_ENV, TELEGRAM_API_URL: value });
      expect(error).toBeDefined();
      expect(error!.message).toContain('префикс пути');
    },
  );

  it.each(['https://tg-api.example.com', 'https://tg-api.example.com/', 'http://localhost:8081'])(
    'TELEGRAM_API_URL принимает %o',
    (value) => {
      const { error } = envValidationSchema.validate({ ...VALID_ENV, TELEGRAM_API_URL: value });
      expect(error).toBeUndefined();
    },
  );

  it('пустой REDIS_PASSWORD допустим — redis в compose поднят без auth', () => {
    const { error } = envValidationSchema.validate({ ...VALID_ENV, REDIS_PASSWORD: '' });
    expect(error).toBeUndefined();
  });

  it('ADMIN_PASSWORD необязателен — без него пароль генерируется сам', () => {
    const { error } = envValidationSchema.validate(VALID_ENV);
    expect(error).toBeUndefined();
  });

  it('пустой ADMIN_PASSWORD допустим и означает «не задан»', () => {
    // Забытый `ADMIN_PASSWORD=` в .env не должен превращаться в пароль из нуля
    // символов; приведение к undefined живёт в AppConfigService.
    const { error } = envValidationSchema.validate({ ...VALID_ENV, ADMIN_PASSWORD: '' });
    expect(error).toBeUndefined();
  });

  it('ADMIN_PASSWORD короче 12 символов отвергается', () => {
    // За паролем стоит переписка продавцов, он один на всех администраторов и
    // живёт до следующего деплоя.
    const { error } = envValidationSchema.validate({ ...VALID_ENV, ADMIN_PASSWORD: 'qwerty' });
    expect(error).toBeDefined();
    expect(error?.message).toContain('ADMIN_PASSWORD');
  });

  it('ADMIN_PASSWORD достаточной длины принимается', () => {
    const { error } = envValidationSchema.validate({
      ...VALID_ENV,
      ADMIN_PASSWORD: 'достаточно-длинный-пароль',
    });
    expect(error).toBeUndefined();
  });

  it('не ругается на посторонние переменные окружения (PATH, HOME и прочее)', () => {
    const { error } = envValidationSchema.validate({ ...VALID_ENV, SOME_OTHER_VAR: 'x' });
    expect(error).toBeUndefined();
  });

  it.each(['abc', '@vasya', '123;456', 'https://t.me/vasya', ''])(
    'TELEGRAM_ADMIN_IDS отвергает %o — это не список числовых id',
    (value) => {
      const { error } = envValidationSchema.validate({
        ...VALID_ENV,
        TELEGRAM_ADMIN_IDS: value,
      });
      expect(error).toBeDefined();
    },
  );

  it.each(['123456789', '123456789,987654321', '123456789, 987654321', ' 123 , 456 '])(
    'TELEGRAM_ADMIN_IDS принимает %o',
    (value) => {
      const { error } = envValidationSchema.validate({
        ...VALID_ENV,
        TELEGRAM_ADMIN_IDS: value,
      });
      expect(error).toBeUndefined();
    },
  );

  it('NODE_ENV принимает только известные значения', () => {
    const { error } = envValidationSchema.validate({ ...VALID_ENV, NODE_ENV: 'staging' });
    expect(error).toBeDefined();
  });

  it('по умолчанию режим апдейтов — webhook', () => {
    const { value } = envValidationSchema.validate(VALID_ENV);
    expect(value.TELEGRAM_UPDATE_MODE).toBe('webhook');
  });

  it('TELEGRAM_UPDATE_MODE принимает только webhook и polling', () => {
    // Опечатка вроде `poling` не должна тихо откатывать режим на вебхук:
    // на российском хостинге это означает бота, который молчит на всё.
    const { error } = envValidationSchema.validate({
      ...VALID_ENV,
      TELEGRAM_UPDATE_MODE: 'poling',
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain('TELEGRAM_UPDATE_MODE');
  });

  it('при polling TELEGRAM_WEBHOOK_URL не обязателен', () => {
    // Требовать публичный домен там, где вебхук принципиально не используется,
    // значит заставить прод придумывать фиктивное значение.
    const env = { ...VALID_ENV, TELEGRAM_UPDATE_MODE: 'polling' };
    delete (env as Record<string, string>).TELEGRAM_WEBHOOK_URL;
    const { error } = envValidationSchema.validate(env);
    expect(error).toBeUndefined();
  });

  it('при webhook отсутствующий TELEGRAM_WEBHOOK_URL по-прежнему падает', () => {
    const env = { ...VALID_ENV, TELEGRAM_UPDATE_MODE: 'webhook' };
    delete (env as Record<string, string>).TELEGRAM_WEBHOOK_URL;
    const { error } = envValidationSchema.validate(env);
    expect(error).toBeDefined();
    expect(error!.message).toContain('TELEGRAM_WEBHOOK_URL');
  });

  it('пустой TELEGRAM_WEBHOOK_URL в режиме webhook читается как «не задан»', () => {
    // docker-compose передаёт ключ пустым, когда его нет в .env.
    const { error } = envValidationSchema.validate({
      ...VALID_ENV,
      TELEGRAM_WEBHOOK_URL: '',
    });
    expect(error).toBeDefined();
    expect(error!.message).toContain('обязателен');
  });
});

describe('AppConfigService (smoke: модуль собирается через Test.createTestingModule)', () => {
  /**
   * Внешних подключений здесь нет — ConfigModule ничего не открывает,
   * поэтому тест не требует ни Mongo, ни Redis.
   */
  async function build(env: Record<string, string>) {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true, // не подхватывать локальный .env
          load: [() => envValidationSchema.validate(env).value],
        }),
      ],
      providers: [AppConfigService],
    }).compile();
    return moduleRef.get(AppConfigService);
  }

  it('DI резолвится и отдаёт типизированные значения', async () => {
    const config = await build(VALID_ENV);
    expect(config.mongoUrl).toBe(VALID_ENV.MONGODB_URL);
    expect(config.mongoDatabase).toBe(VALID_ENV.MONGODB_DATABASE);
    expect(config.redisHost).toBe('localhost');
    expect(config.redisPort).toBe(6379);
    expect(config.port).toBe(3000);
    expect(config.telegramWebhookUrl).toBe(VALID_ENV.TELEGRAM_WEBHOOK_URL);
  });

  it('telegramApiUrl срезает хвостовой слеш', async () => {
    // TelegramApiService дописывает `/bot<token>/...` шаблоном — со слешем
    // получился бы `https://h//bot…`.
    const config = await build({ ...VALID_ENV, TELEGRAM_API_URL: 'https://mirror.example.com/' });
    expect(config.telegramApiUrl).toBe('https://mirror.example.com');
  });

  it('пустой пароль Redis превращается в undefined, а не в пустую строку', async () => {
    // Пустой пароль при выключенном auth заставляет сервер писать
    // предупреждение на КАЖДОЕ соединение — ровно это чинили в TASK-002.
    const config = await build({ ...VALID_ENV, REDIS_PASSWORD: '' });
    expect(config.redisPassword).toBeUndefined();
  });

  it('непустой пароль Redis пробрасывается как есть', async () => {
    const config = await build({ ...VALID_ENV, REDIS_PASSWORD: 'secret' });
    expect(config.redisPassword).toBe('secret');
  });

  it('незаданный ADMIN_PASSWORD — это undefined: пароль сгенерируется сам', async () => {
    const config = await build(VALID_ENV);
    expect(config.adminPassword).toBeUndefined();
  });

  it('пустой ADMIN_PASSWORD превращается в undefined, а не в пароль из нуля символов', async () => {
    // Иначе забытый `ADMIN_PASSWORD=` в .env открывал бы панель пустым паролем.
    const config = await build({ ...VALID_ENV, ADMIN_PASSWORD: '' });
    expect(config.adminPassword).toBeUndefined();
  });

  it('заданный ADMIN_PASSWORD пробрасывается как есть', async () => {
    const config = await build({ ...VALID_ENV, ADMIN_PASSWORD: 'достаточно-длинный-пароль' });
    expect(config.adminPassword).toBe('достаточно-длинный-пароль');
  });

  it('TELEGRAM_ADMIN_IDS разбирается в числа, а не в строки', async () => {
    // Если оставить строки, сравнение с ctx.from.id (число) всегда даёт false,
    // и ни один администратор не будет опознан — молча, без единой ошибки.
    const config = await build(VALID_ENV);
    expect(config.telegramAdminIds).toEqual([123456789, 987654321]);
  });

  it('isAdmin опознаёт администратора и отсекает остальных', async () => {
    const config = await build({ ...VALID_ENV, TELEGRAM_ADMIN_IDS: ' 111 , 222 ' });
    expect(config.isAdmin(111)).toBe(true);
    expect(config.isAdmin(222)).toBe(true);
    expect(config.isAdmin(333)).toBe(false);
  });

  it('isProduction отражает NODE_ENV', async () => {
    expect((await build({ ...VALID_ENV, NODE_ENV: 'production' })).isProduction).toBe(true);
    expect((await build(VALID_ENV)).isProduction).toBe(false);
  });
});
