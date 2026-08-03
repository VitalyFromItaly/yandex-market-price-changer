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

/**
 * Базовый URL, к которому потом дописывают путь, не должен нести своего пути.
 * Подробнее — в комментарии к TELEGRAM_API_URL ниже.
 */
const rejectUrlWithPath: Joi.CustomValidator<string> = (value, helpers) => {
  const { pathname } = new URL(value);
  if (pathname !== '/') {
    return helpers.message({
      custom:
        `${helpers.state.path?.join('.')}: префикс пути ('${pathname}') не поддерживается — ` +
        'укажите только схему и хост, например https://tg-api.example.com',
    });
  }
  return value;
};

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  PORT: Joi.number().port().default(3000),

  /**
   * Разрешена ли ЗАПИСЬ ОСТАТКОВ в Partner API. Единственная мутация всего
   * приложения — всё остальное только читает.
   *
   * ОБЯЗАТЕЛЬНА И БЕЗ УМОЛЧАНИЯ, намеренно. Умолчание любого знака плохо:
   * «по умолчанию можно» однажды запишет остатки живого продавца с чьей-то
   * локальной машины (токен в `.env` настоящий, откатить это нечем — Яндекс не
   * сообщает, что именно применилось), а «по умолчанию нельзя» так же тихо
   * выключит загрузку в проде, и узнают об этом по жалобе через неделю.
   * Поэтому каждая среда обязана заявить решение сама, а забытая переменная
   * роняет приложение на старте с внятным текстом.
   *
   * Строки, а не Joi.boolean(): при коэрции строка 'false' — истина, и такая
   * опечатка включила бы запись молча. Тот же приём, что у TELEGRAM_UPDATE_MODE.
   */
  STOCK_WRITE_ENABLED: Joi.string()
    .valid('true', 'false')
    .required()
    .messages({
      'any.required':
        'STOCK_WRITE_ENABLED обязателен: true — бот пишет остатки в Яндекс.Маркет, ' +
        'false — только разбирает прайс и сохраняет закупочные цены. ' +
        'Для локальной разработки ставьте false: токен в .env боевой.',
      'any.only': 'STOCK_WRITE_ENABLED принимает только true или false',
    }),

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
  /*
   * Как забираем апдейты: `webhook` (Telegram стучится к нам) или `polling`
   * (мы сами опрашиваем Bot API).
   *
   * Это не вопрос вкуса, а вопрос сетевой достижимости. Прод стоит на
   * российском хостинге (MNOGOWEB-MSK), и фильтрация трафика Telegram работает
   * в ОБЕ стороны: исходящие запросы к api.telegram.org уже ходят через зеркало
   * из TELEGRAM_API_URL, а входящая доставка вебхука упирается в то же самое —
   * getWebhookInfo отдавал «Connection timed out» при полностью исправном
   * приложении (HTTP/2 200 снаружи, валидный сертификат). Polling переворачивает
   * направление и уходит через то же рабочее зеркало.
   *
   * Дефолт `webhook` сохраняет режим для локальной разработки через туннель.
   */
  TELEGRAM_UPDATE_MODE: Joi.string().valid('webhook', 'polling').default('webhook').messages({
    'any.only': "TELEGRAM_UPDATE_MODE: допустимы только 'webhook' или 'polling'",
  }),
  // Куда Telegram шлёт апдейты НАМ. Раньше ключ назывался TELEGRAM_PROXY_URL,
  // хотя никаким прокси не был — рядом с настоящим TELEGRAM_API_URL это имя
  // напрашивалось на то, чтобы значения перепутали местами.
  //
  // В режиме polling переменная не нужна вовсе: требовать её значило бы
  // заставить прод придумывать фиктивный домен ради проверки, которая ни на
  // что не влияет.
  TELEGRAM_WEBHOOK_URL: Joi.string()
    .uri()
    // Пустая строка = «не задано»: и в .env.example, и в docker-compose ключ
    // присутствует пустым. Без empty('') режим webhook падал бы с невнятным
    // «is not allowed to be empty» вместо сообщения про обязательность.
    .empty('')
    .when('TELEGRAM_UPDATE_MODE', {
      is: 'polling',
      then: Joi.optional(),
      otherwise: Joi.required(),
    })
    .messages({
      'any.required':
        'TELEGRAM_WEBHOOK_URL обязателен при TELEGRAM_UPDATE_MODE=webhook: ' +
        'публичный HTTPS-домен для вебхука (например, ngrok)',
      'string.uri': 'TELEGRAM_WEBHOOK_URL должен быть полным URL со схемой https://',
    }),
  // Куда ходим МЫ: своё зеркало Bot API вместо api.telegram.org. Дефолт —
  // прямой адрес, чтобы приложение работало и без зеркала.
  //
  // Только схема + хост (+порт), без пути. Telegraf собирает адрес метода как
  // new URL('./bot<token>/<method>', apiRoot), а такое разрешение отбрасывает
  // последний сегмент пути базы: 'https://h/tg' превращается в 'https://h/botX/...'.
  // Все запросы молча уходят в 404, бот выглядит мёртвым и в логах — ничего.
  //
  // empty('') — потому что в .env.example ключ присутствует с пустым значением:
  // без этого скопированный шаблон падал бы на старте с «must be a valid uri»,
  // хотя пустое значение означает ровно «зеркала нет, идём напрямую».
  TELEGRAM_API_URL: Joi.string()
    .uri()
    .custom(rejectUrlWithPath, 'без пути')
    .empty('')
    .default('https://api.telegram.org'),
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

  // --- Админ-панель ---
  // Пароль панели. Необязателен: без него он генерируется при первом запуске и
  // один раз печатается в логах. Задан — ГЛАВНЕЕ базы, то есть меняется правкой
  // переменной и рестартом, без похода в Mongo.
  //
  // Пустая строка — это «не задан», как у REDIS_PASSWORD: иначе забытый
  // `ADMIN_PASSWORD=` в .env означал бы пароль из нуля символов.
  //
  // Минимум 12 символов. За паролем стоит переписка продавцов, а сам он один на
  // всех администраторов и живёт до следующего деплоя; блокировка после пяти
  // промахов замедляет подбор, но не отменяет его.
  ADMIN_PASSWORD: Joi.string().min(12).allow('').optional().messages({
    'string.min': 'ADMIN_PASSWORD: не короче 12 символов (или оставьте пустым — сгенерируется сам)',
  }),

  // --- Yandex Market Partner API ---
  // Токен продавца здесь НЕ хранится: каждый пользователь вводит свой через
  // бота, и он лежит в БД, скоупленный по telegramUserId.
  YANDEX_MARKET_BASE_URL: Joi.string().uri().default('https://api.partner.market.yandex.ru'),
})
  // Неизвестные переменные пропускаем: в окружении полно посторонних (PATH,
  // HOME и прочее), плюс в .env остались неиспользуемые ключи от прежних задач.
  .unknown(true);
