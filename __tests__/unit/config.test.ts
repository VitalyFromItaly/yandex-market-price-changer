import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from '../../src/config/env.validation';
import { AppConfigService } from '../../src/config/app-config.service';

/** Полный валидный набор — база для сценариев «убрали одну переменную». */
const VALID_ENV = {
  STOCK_WRITE_ENABLED: 'false',
  MONGODB_URL: 'mongodb://root:secret@localhost:27018/',
  MONGODB_DATABASE: 'yandex-market-price-changer',
  POSTGRES_URL: 'postgres://finance:secret@localhost:5433/finance',
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
    'STOCK_WRITE_ENABLED',
    'MONGODB_URL',
    'MONGODB_DATABASE',
    'POSTGRES_URL',
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

  it('POSTGRES_URL — только postgres:// или postgresql://', () => {
    for (const bad of ['mongodb://root:secret@localhost:27018/', 'localhost:5432']) {
      const { error } = envValidationSchema.validate({ ...VALID_ENV, POSTGRES_URL: bad });
      expect(error?.message).toContain('POSTGRES_URL');
    }
    const ok = 'postgresql://u:p@db:5432/finance';
    expect(envValidationSchema.validate({ ...VALID_ENV, POSTGRES_URL: ok }).error).toBeUndefined();
  });

  it('STOCK_WRITE_ENABLED не имеет умолчания — среда обязана заявить решение', () => {
    // Умолчание любого знака плохо: «можно» однажды перепишет остатки живого
    // продавца с локальной машины, «нельзя» тихо выключит загрузку в проде.
    const env = { ...VALID_ENV };
    delete (env as Record<string, string>).STOCK_WRITE_ENABLED;
    const { error, value } = envValidationSchema.validate(env);

    expect(error).toBeDefined();
    expect(value.STOCK_WRITE_ENABLED).toBeUndefined();
    // Сообщение обязано объяснить, что ставить локально.
    expect(error!.message).toContain('false');
  });

  it.each(['1', '0', 'yes', 'True', ''])('STOCK_WRITE_ENABLED отвергает %o', (value) => {
    // Только точные true/false: 'True' или '1' — это опечатка, а не намерение,
    // и трактовать её как «включено» нельзя.
    const { error } = envValidationSchema.validate({ ...VALID_ENV, STOCK_WRITE_ENABLED: value });
    expect(error).toBeDefined();
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

  it('OZON_SELLER_API_URL: умолчание, пусто — умолчание, путь отвергается', () => {
    expect(envValidationSchema.validate(VALID_ENV).value.OZON_SELLER_API_URL).toBe(
      'https://api-seller.ozon.ru',
    );
    expect(
      envValidationSchema.validate({ ...VALID_ENV, OZON_SELLER_API_URL: '' }).value
        .OZON_SELLER_API_URL,
    ).toBe('https://api-seller.ozon.ru');
    // Клиент дописывает путь метода от корня: /v1 в базе превратил бы /v1/roles в 404.
    const { error } = envValidationSchema.validate({
      ...VALID_ENV,
      OZON_SELLER_API_URL: 'https://api-seller.ozon.ru/v1',
    });
    expect(error!.message).toContain('OZON_SELLER_API_URL');
    expect(error!.message).toContain('префикс пути');
  });

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

  describe('Polza.ai', () => {
    it('AI_USER_DAILY_LIMIT_RUB: умолчание 50 ₽, пусто — тоже 50, 0 — без лимита', () => {
      expect(envValidationSchema.validate(VALID_ENV).value.AI_USER_DAILY_LIMIT_RUB).toBe(50);
      expect(
        envValidationSchema.validate({ ...VALID_ENV, AI_USER_DAILY_LIMIT_RUB: '' }).value
          .AI_USER_DAILY_LIMIT_RUB,
      ).toBe(50);
      const zero = envValidationSchema.validate({ ...VALID_ENV, AI_USER_DAILY_LIMIT_RUB: '0' });
      expect(zero.error).toBeUndefined();
      expect(zero.value.AI_USER_DAILY_LIMIT_RUB).toBe(0);
      expect(
        envValidationSchema.validate({ ...VALID_ENV, AI_USER_DAILY_LIMIT_RUB: '12.5' }).value
          .AI_USER_DAILY_LIMIT_RUB,
      ).toBe(12.5);
    });

    it('AI_USER_DAILY_LIMIT_RUB: отрицательное и не-число отвергаются по имени', () => {
      for (const bad of ['-1', 'abc']) {
        const { error } = envValidationSchema.validate({
          ...VALID_ENV,
          AI_USER_DAILY_LIMIT_RUB: bad,
        });
        expect(error?.message).toContain('AI_USER_DAILY_LIMIT_RUB');
      }
    });

    it('POLZA_AI_BALANCE_WARN_RUB: умолчание 200 ₽, пусто — тоже 200, 0 допустим', () => {
      expect(envValidationSchema.validate(VALID_ENV).value.POLZA_AI_BALANCE_WARN_RUB).toBe(200);
      expect(
        envValidationSchema.validate({ ...VALID_ENV, POLZA_AI_BALANCE_WARN_RUB: '' }).value
          .POLZA_AI_BALANCE_WARN_RUB,
      ).toBe(200);
      const zero = envValidationSchema.validate({ ...VALID_ENV, POLZA_AI_BALANCE_WARN_RUB: '0' });
      expect(zero.error).toBeUndefined();
      expect(zero.value.POLZA_AI_BALANCE_WARN_RUB).toBe(0);
    });

    it('POLZA_AI_BALANCE_WARN_RUB: отрицательное и не-число отвергаются по имени', () => {
      for (const bad of ['-1', 'abc']) {
        const { error } = envValidationSchema.validate({
          ...VALID_ENV,
          POLZA_AI_BALANCE_WARN_RUB: bad,
        });
        expect(error?.message).toContain('POLZA_AI_BALANCE_WARN_RUB');
      }
    });

    it('без токена и модели стартует — ИИ необязателен', () => {
      const { error } = envValidationSchema.validate(VALID_ENV);
      expect(error).toBeUndefined();
    });

    it('пустой токен без модели — это «не задан», а не ключ без модели', () => {
      const { error } = envValidationSchema.validate({
        ...VALID_ENV,
        POLZA_AI_TOKEN: '',
        POLZA_AI_MODEL: '',
      });
      expect(error).toBeUndefined();
    });

    it('токен без модели роняет старт с именем переменной', () => {
      const { error } = envValidationSchema.validate({
        ...VALID_ENV,
        POLZA_AI_TOKEN: 'pza_secret',
      });
      expect(error).toBeDefined();
      expect(error!.message).toContain('POLZA_AI_MODEL');
      expect(error!.message).toContain('обязателен');
    });

    it('токен с моделью проходит', () => {
      const { error } = envValidationSchema.validate({
        ...VALID_ENV,
        POLZA_AI_TOKEN: 'pza_secret',
        POLZA_AI_MODEL: 'openai/gpt-4o-mini',
      });
      expect(error).toBeUndefined();
    });

    it('POLZA_AI_MODELS: пусто и отсутствие — без переопределений, пары с пробелами проходят', () => {
      expect(envValidationSchema.validate(VALID_ENV).error).toBeUndefined();
      expect(
        envValidationSchema.validate({ ...VALID_ENV, POLZA_AI_MODELS: '' }).error,
      ).toBeUndefined();
      const { error } = envValidationSchema.validate({
        ...VALID_ENV,
        POLZA_AI_MODELS: ' feedback-reply = cheap/model , analyst=strong/model,',
      });
      expect(error).toBeUndefined();
    });

    it('POLZA_AI_MODELS: незнакомый purpose, кривая пара и повтор роняют старт по имени', () => {
      const cases: [string, string][] = [
        ['chat=strong/model', "неизвестное назначение 'chat'"],
        ['analyst', 'purpose=модель'],
        ['analyst=', 'purpose=модель'],
        ['=strong/model', 'purpose=модель'],
        ['analyst=a,analyst=b', 'дважды'],
      ];
      for (const [raw, reason] of cases) {
        const { error } = envValidationSchema.validate({ ...VALID_ENV, POLZA_AI_MODELS: raw });
        expect(error?.message, raw).toContain('POLZA_AI_MODELS');
        expect(error?.message, raw).toContain(reason);
      }
    });

    it('пустой POLZA_AI_BASE_URL подставляет умолчание', () => {
      const { value, error } = envValidationSchema.validate({
        ...VALID_ENV,
        POLZA_AI_BASE_URL: '',
      });
      expect(error).toBeUndefined();
      expect(value.POLZA_AI_BASE_URL).toBe('https://polza.ai/api');
    });

    it.each([
      'https://polza.ai/api',
      'https://polza.ai/api/',
      'https://mirror.example.com:8443/api',
    ])('база %s принимается', (url) => {
      const { error } = envValidationSchema.validate({ ...VALID_ENV, POLZA_AI_BASE_URL: url });
      expect(error).toBeUndefined();
    });

    it.each(['', 'http://194.0.0.1:8888', 'http://proxy.example.com:3128/'])(
      'прокси %s принимается',
      (url) => {
        const { error } = envValidationSchema.validate({ ...VALID_ENV, POLZA_AI_PROXY_URL: url });
        expect(error).toBeUndefined();
      },
    );

    it.each(['https://194.0.0.1:8888', 'http://194.0.0.1:8888/api', 'socks5://h:1080', 'h:8888'])(
      'прокси %s отвергается',
      (url) => {
        const { error } = envValidationSchema.validate({ ...VALID_ENV, POLZA_AI_PROXY_URL: url });
        expect(error).toBeDefined();
        expect(error!.message).toContain('POLZA_AI_PROXY_URL');
      },
    );

    it.each([
      'https://polza.ai',
      'https://polza.ai/',
      'https://polza.ai/api/v1',
      'https://h.example.com/x',
    ])('база %s отвергается — путь метода к ней дописывается, и запросы ушли бы в 404', (url) => {
      const { error } = envValidationSchema.validate({ ...VALID_ENV, POLZA_AI_BASE_URL: url });
      expect(error).toBeDefined();
      expect(error!.message).toContain('POLZA_AI_BASE_URL');
      expect(error!.message).toContain('/api');
    });
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

  it('polzaAiModelFor: переопределение по назначению, иначе POLZA_AI_MODEL', async () => {
    const config = await build({
      ...VALID_ENV,
      POLZA_AI_TOKEN: 'pza_secret',
      POLZA_AI_MODEL: 'default/model',
      POLZA_AI_MODELS: 'feedback-reply=cheap/model,analyst=strong/model',
    });
    expect(config.polzaAiModelFor('feedback-reply')).toBe('cheap/model');
    expect(config.polzaAiModelFor('analyst')).toBe('strong/model');
    expect(config.polzaAiModelFor('weekly-digest')).toBe('default/model');
    expect([...config.polzaAiModels.keys()]).toEqual(['feedback-reply', 'analyst']);
  });

  it('polzaAiModels: без переменной — пустая карта, модель по умолчанию для всех', async () => {
    const config = await build({
      ...VALID_ENV,
      POLZA_AI_TOKEN: 'pza_secret',
      POLZA_AI_MODEL: 'default/model',
    });
    expect(config.polzaAiModels.size).toBe(0);
    expect(config.polzaAiModelFor('analyst')).toBe('default/model');
  });

  it('DI резолвится и отдаёт типизированные значения', async () => {
    const config = await build(VALID_ENV);
    expect(config.mongoUrl).toBe(VALID_ENV.MONGODB_URL);
    expect(config.mongoDatabase).toBe(VALID_ENV.MONGODB_DATABASE);
    expect(config.postgresUrl).toBe(VALID_ENV.POSTGRES_URL);
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

  it('без токена Polza ИИ выключен, пустой токен — тоже undefined', async () => {
    const absent = await build(VALID_ENV);
    expect(absent.polzaAiEnabled).toBe(false);
    expect(absent.polzaAiToken).toBeUndefined();
    expect(absent.polzaAiBaseUrl).toBe('https://polza.ai/api');

    const empty = await build({ ...VALID_ENV, POLZA_AI_TOKEN: '', POLZA_AI_MODEL: '' });
    expect(empty.polzaAiEnabled).toBe(false);
    expect(empty.polzaAiToken).toBeUndefined();
    expect(empty.polzaAiModel).toBeUndefined();
  });

  it('с токеном и моделью ИИ включён, база без хвостового слеша', async () => {
    const config = await build({
      ...VALID_ENV,
      POLZA_AI_TOKEN: 'pza_secret',
      POLZA_AI_MODEL: 'openai/gpt-4o-mini',
      POLZA_AI_BASE_URL: 'https://polza.ai/api/',
    });
    expect(config.polzaAiEnabled).toBe(true);
    expect(config.polzaAiToken).toBe('pza_secret');
    expect(config.polzaAiModel).toBe('openai/gpt-4o-mini');
    expect(config.polzaAiBaseUrl).toBe('https://polza.ai/api');
  });

  it('база Ozon — без хвостового слеша', async () => {
    const config = await build({ ...VALID_ENV, OZON_SELLER_API_URL: 'https://ozon.example.com/' });
    expect(config.ozonSellerApiUrl).toBe('https://ozon.example.com');
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

  it('stockWriteEnabled читает СТРОКУ, а не приводит к булеву', async () => {
    // Классическая ловушка коэрции: Boolean('false') === true. Такая опечатка
    // включила бы запись остатков в чужой магазин молча.
    expect((await build({ ...VALID_ENV, STOCK_WRITE_ENABLED: 'true' })).stockWriteEnabled).toBe(
      true,
    );
    expect((await build({ ...VALID_ENV, STOCK_WRITE_ENABLED: 'false' })).stockWriteEnabled).toBe(
      false,
    );
  });

  it('stockWriteEnabled НЕ выводится из NODE_ENV', async () => {
    // «Продовость» и «можно ли трогать чужой склад» — разные вопросы. Связать
    // их значило бы менять второе, правя первое.
    const prodNoWrite = await build({
      ...VALID_ENV,
      NODE_ENV: 'production',
      STOCK_WRITE_ENABLED: 'false',
    });
    expect(prodNoWrite.isProduction).toBe(true);
    expect(prodNoWrite.stockWriteEnabled).toBe(false);
  });
});
