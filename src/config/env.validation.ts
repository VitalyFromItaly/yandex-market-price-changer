import * as Joi from 'joi';

/**
 * Схема валидации переменных окружения.
 *
 * Зачем. Раньше значения читались из `process.env` напрямую и в момент
 * ВЫЧИСЛЕНИЯ ДЕКОРАТОРА модуля. Из-за этого:
 *
 * 1. `BullModule.forRoot` в app.module.ts работал только благодаря случайному
 *    порядку импортов — `import 'dotenv/config'` стоял в database.module.ts и
 *    исполнялся раньше. Достаточно было переставить импорты, чтобы Redis-хост
 *    молча стал `localhost`.
 * 2. Отсутствие переменной обнаруживалось не при старте, а в рантайме — в виде
 *    невнятной ошибки подключения. `MongooseModule.forRoot(undefined)` — это не
 *    «нет конфига», это долгий таймаут где-то потом.
 *
 * Теперь приложение падает на старте с указанием конкретной переменной.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  PORT: Joi.number().port().default(3000),

  // --- MongoDB ---
  // Строка подключения БЕЗ имени базы — имя идёт отдельно в MONGODB_DATABASE.
  MONGODB_URL: Joi.string().required().messages({
    'any.required':
      'MONGODB_URL обязателен: строка подключения к MongoDB, например mongodb://root:secret@localhost:27018/',
  }),
  MONGODB_DATABASE: Joi.string().required().messages({
    'any.required': 'MONGODB_DATABASE обязателен: имя базы данных',
  }),

  // --- Redis (очереди Bull) ---
  // Без явного хоста Bull молча уходит на localhost:6379, что внутри
  // контейнера означает «сам в себя».
  REDIS_HOST: Joi.string().required().messages({
    'any.required': 'REDIS_HOST обязателен: без него Bull молча подключится к localhost',
  }),
  REDIS_PORT: Joi.number().port().default(6379),
  // Пустая строка — валидное значение: redis в docker-compose поднят без auth.
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // --- Telegram ---
  TELEGRAM_TOKEN: Joi.string().required().messages({
    'any.required': 'TELEGRAM_TOKEN обязателен: токен бота от @BotFather',
  }),
  TELEGRAM_PROXY_URL: Joi.string().uri().required().messages({
    'any.required':
      'TELEGRAM_PROXY_URL обязателен: публичный HTTPS-домен для вебхука (например, ngrok)',
    'string.uri': 'TELEGRAM_PROXY_URL должен быть полным URL со схемой https://',
  }),
  // Обязателен, а не «пустой список по умолчанию»: без единого администратора
  // ни одну заявку невозможно одобрить, и каждый новый пользователь навсегда
  // повисает в статусе pending — молча, без единой ошибки в логах.
  TELEGRAM_ADMIN_IDS: Joi.string()
    .pattern(/^\s*\d+(\s*,\s*\d+)*\s*$/)
    .required()
    .messages({
      'any.required':
        'TELEGRAM_ADMIN_IDS обязателен: Telegram id администраторов через запятую, например 123456789,987654321',
      'string.pattern.base':
        'TELEGRAM_ADMIN_IDS: только числовые id через запятую (не @username и не ссылка). Свой id можно узнать у @userinfobot',
    }),

  // --- Yandex Market Partner API ---
  // Токен продавца здесь НЕ хранится: каждый пользователь вводит свой через
  // бота, и он лежит в БД, скоупленный по telegramUserId.
  YANDEX_MARKET_BASE_URL: Joi.string().uri().default('https://api.partner.market.yandex.ru'),
})
  // Неизвестные переменные пропускаем: в окружении полно посторонних (PATH,
  // HOME и прочее), плюс в .env остались неиспользуемые ключи от прежних задач.
  .unknown(true);
