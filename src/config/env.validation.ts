import * as Joi from 'joi';

import { parseAiModelOverrides } from '../modules/ai/ai-purpose';

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

/**
 * База Polza.ai обязана заканчиваться ровно на `/api` — ни больше, ни меньше.
 * Клиент дописывает к ней путь метода (`/v1/chat/completions`), поэтому лишний
 * сегмент (`/api/v1`) или пропущенный (`https://polza.ai`) не роняет ничего на
 * старте, а молча превращает каждый запрос в 404 — та же беда, что у
 * TELEGRAM_API_URL с путём, только с обратным знаком.
 */
const requireApiPath: Joi.CustomValidator<string> = (value, helpers) => {
  const pathname = new URL(value).pathname.replace(/\/+$/, '');
  if (pathname !== '/api') {
    return helpers.message({
      custom:
        `${helpers.state.path?.join('.')}: путь должен быть ровно /api (сейчас '${pathname || '/'}') — ` +
        'например https://polza.ai/api',
    });
  }
  return value;
};

const PROXY_URL_HINT = 'POLZA_AI_PROXY_URL: нужен http://хост:порт, например http://194.0.0.1:8888';

/** Прокси — только `http://хост:порт`: путь или query у него выдают опечатку. */
const requireProxyOrigin: Joi.CustomValidator<string> = (value, helpers) => {
  const url = new URL(value);
  if (url.pathname.replace(/\/+$/, '') !== '' || url.search) {
    return helpers.message({ custom: PROXY_URL_HINT });
  }
  return value;
};

/** `purpose=модель` через запятую; незнакомое назначение — опечатка, а не пропуск. */
const requireModelOverrides: Joi.CustomValidator<string> = (value, helpers) => {
  const parsed = parseAiModelOverrides(value);
  if ('error' in parsed) {
    return helpers.message({
      custom: `POLZA_AI_MODELS: ${parsed.error} (формат: feedback-reply=модель,analyst=модель)`,
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

  /**
   * Разрешена ли ЗАПИСЬ ЦЕН на площадки («Установка цен», TASK-200). Отдельно
   * от STOCK_WRITE_ENABLED: цена — другая мутация с другой ценой ошибки
   * (товар за копейки уходит покупателям за минуты), и включать её вместе с
   * остатками значило бы решать два вопроса одним рычагом. Обязательна и без
   * умолчания по той же причине, что STOCK_WRITE_ENABLED.
   */
  PRICE_WRITE_ENABLED: Joi.string()
    .valid('true', 'false')
    .required()
    .messages({
      'any.required':
        'PRICE_WRITE_ENABLED обязателен: true — «Установка цен» пишет цены на площадки, ' +
        'false — только превью, на площадки не уходит ничего. ' +
        'Для локальной разработки ставьте false: токен в .env боевой.',
      'any.only': 'PRICE_WRITE_ENABLED принимает только true или false',
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

  // --- Postgres (только финансы, M16–M25: решение finance_postgres) ---
  // Mongo прода — один узел без replica set, транзакций там нет, а замена версии
  // финансового отчёта обязана быть атомарной. Обязателен без умолчания: тихий
  // localhost внутри контейнера означал бы «сам в себя» (довод REDIS_HOST).
  POSTGRES_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required()
    .messages({
      'any.required':
        'POSTGRES_URL обязателен: строка подключения к Postgres для финансов, ' +
        'например postgres://finance:secret@localhost:5433/finance',
      'string.uri': 'POSTGRES_URL должен начинаться с postgres:// или postgresql://',
      'string.uriCustomScheme': 'POSTGRES_URL должен начинаться с postgres:// или postgresql://',
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

  // --- CRM продавцов ---
  // Стартовый пароль входа в CRM, один на всех текущих продавцов. Он действует
  // только до первой смены: пока продавец его не сменил, CRM пускает его лишь на
  // экран смены пароля. Умолчание — решение владельца (2026-09-23): деплой не
  // должен падать из-за этой переменной.
  CRM_INITIAL_PASSWORD: Joi.string().min(8).default('tg_rules_2026').messages({
    'string.min': 'CRM_INITIAL_PASSWORD: не короче 8 символов',
    'string.empty':
      'CRM_INITIAL_PASSWORD: не может быть пустым (уберите переменную — будет умолчание)',
  }),

  // --- Polza.ai (ИИ) ---
  // ИИ — надстройка, а не условие работы бота: деплой без ключа обязан
  // стартовать, а ИИ-функции — молча считаться выключенными. Поэтому токен
  // необязателен, и пустая строка значит «не задан» (прецедент REDIS_PASSWORD):
  // в .env.example и docker-compose ключ присутствует пустым. empty('') здесь
  // ещё и для when ниже — без него пустой токен считался бы «заданным» и
  // требовал модель.
  POLZA_AI_TOKEN: Joi.string().empty('').optional(),
  // Только схема + хост + /api, см. requireApiPath. Пусто — умолчание.
  POLZA_AI_BASE_URL: Joi.string()
    .uri()
    .custom(requireApiPath, 'путь /api')
    .empty('')
    .default('https://polza.ai/api'),
  // HTTP-прокси только для Polza: `http://хост:порт`, пусто — напрямую. Нужен,
  // когда сеть хостинга Polza не пускает IP сервера бота (14-10-2026: с NL-хоста
  // TCP до polza.ai не устанавливался, через KZ-узел — 401 за 1 с). Схема http
  // и без пути: TLS до самой Polza идёт сквозь CONNECT, прокси ключа не видит.
  // Яндекс и Telegram этот прокси не касается.
  POLZA_AI_PROXY_URL: Joi.string()
    .uri({ scheme: ['http'] })
    .custom(requireProxyOrigin, 'прокси без пути')
    .empty('')
    .optional()
    .messages({
      'string.uriCustomScheme': PROXY_URL_HINT,
      'string.uri': PROXY_URL_HINT,
    }),
  // Обязательна, только если задан токен. Умолчания нет НАМЕРЕННО: выбор модели
  // — это выбор цены за запрос, и делать его молча за владельца нельзя.
  // Ключ без модели — незаконченная настройка, о ней лучше узнать на старте,
  // чем по первому отказу Polza в рантайме.
  POLZA_AI_MODEL: Joi.string()
    .empty('')
    .when('POLZA_AI_TOKEN', { is: Joi.exist(), then: Joi.required(), otherwise: Joi.optional() })
    .messages({
      'any.required':
        'POLZA_AI_MODEL обязателен, когда задан POLZA_AI_TOKEN: идентификатор модели Polza.ai ' +
        '(или уберите POLZA_AI_TOKEN — ИИ будет выключен)',
    }),
  // Модель по назначению (TASK-171): `purpose=модель` через запятую поверх
  // POLZA_AI_MODEL — дешёвая для черновиков и сводки, сильнее для чата. Пусто —
  // все назначения идут моделью по умолчанию. Список назначений закрытый
  // (ai-purpose.ts): опечатка в purpose иначе молча оставила бы дорогую модель.
  POLZA_AI_MODELS: Joi.string().empty('').optional().custom(requireModelOverrides),
  // Дневной лимит расхода на ИИ на одного продавца, в рублях за московские
  // сутки. Ключ Polza один на всех и платит владелец, поэтому умолчание —
  // ограничение, а не его отсутствие (решение владельца 2026-10-14: 50 ₽).
  // 0 — без лимита, это явное решение в env, а не случайность.
  AI_USER_DAILY_LIMIT_RUB: Joi.number().min(0).empty('').default(50).messages({
    'number.base': 'AI_USER_DAILY_LIMIT_RUB: число рублей (0 — без лимита)',
    'number.min': 'AI_USER_DAILY_LIMIT_RUB: не может быть отрицательным (0 — без лимита)',
  }),
  // Порог баланса Polza для самопроверки, ₽: ниже — «скоро закончится».
  // Рубли, а не доля, как у диска: у баланса нет «всего», есть остаток и темп
  // трат (решение владельца 2026-10-14: 200 ₽). 0 — предупреждение выключено,
  // но баланс ≤ 0 остаётся аварией: каждый запрос получит 402.
  POLZA_AI_BALANCE_WARN_RUB: Joi.number().min(0).empty('').default(200).messages({
    'number.base': 'POLZA_AI_BALANCE_WARN_RUB: число рублей (0 — не предупреждать)',
    'number.min': 'POLZA_AI_BALANCE_WARN_RUB: не может быть отрицательным (0 — не предупреждать)',
  }),

  // --- Yandex Market Partner API ---
  // Токен продавца здесь НЕ хранится: каждый пользователь вводит свой через
  // бота, и он лежит в БД, скоупленный по telegramUserId.
  YANDEX_MARKET_BASE_URL: Joi.string().uri().default('https://api.partner.market.yandex.ru'),

  // --- Ozon Seller API ---
  // Ключи продавца (Client-Id + Api-Key) здесь НЕ хранятся: они вводятся в CRM
  // и лежат в MarketplaceConnection. Только схема + хост: клиент дописывает путь
  // метода от корня (`/v1/roles`), и префикс пути в базе молча превратил бы каждый
  // запрос в 404 — та же беда, что у TELEGRAM_API_URL.
  OZON_SELLER_API_URL: Joi.string()
    .uri()
    .custom(rejectUrlWithPath, 'без пути')
    .empty('')
    .default('https://api-seller.ozon.ru'),
})
  // Неизвестные переменные пропускаем: в окружении полно посторонних (PATH,
  // HOME и прочее), плюс в .env остались неиспользуемые ключи от прежних задач.
  .unknown(true);
