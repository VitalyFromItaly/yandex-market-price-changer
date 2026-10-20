export const QUEUE_NAMES = {
  FILE_PROCESSING: 'file-processing',
  YANDEX_API: 'yandex-api',
  NOTIFICATIONS: 'notifications',
  REPORTS: 'reports',
  /**
   * Фоновые задачи CRM: результат уходит не в Telegram, а в коллекцию
   * CrmJobResult, откуда его забирает веб. Своя очередь, а не `reports`: там
   * `@OnQueueFailed` уже занят ReportsProcessor.
   */
  CRM_JOBS: 'crm-jobs',
  /**
   * Импорт финансового журнала площадок (united-netting ЯМ): заказ отчёта,
   * минуты ожидания, разбор десятков тысяч строк. Своя очередь с одним
   * обработчиком на concurrency 1: две загрузки одного периода упёрлись бы в
   * уникальный индекс версии FinanceDocument.
   */
  FINANCE_IMPORT: 'finance-import',
  /**
   * Проверка уведомлений продавцу (TASK-152): правила по журналу, аномалиям,
   * налогу и складу (остатки — живые вызовы площадок), сводка в Telegram.
   * Своя очередь (решение `notifications_own_queue`): `notifications` занята
   * прогрессом загрузки прайса, а на `reports` сверка ReportScheduler снимает
   * чужие повторяемые задачи.
   */
  SELLER_NOTIFICATIONS: 'seller-notifications',
  /**
   * Еженедельная ИИ-сводка в Telegram (TASK-168). Своя очередь по доводу
   * `notifications_own_queue`: на `reports` сверка ReportScheduler снимает
   * чужие повторяемые задачи, а `@OnQueueFailed` там уже у ReportsProcessor.
   */
  AI_WEEKLY_DIGEST: 'ai-weekly-digest',
} as const;

export const JOB_TYPES = {
  /**
   * Живая загрузка прайса: одна джоба «скачать → разобрать → записать» в
   * очереди file-processing. НЕ часть мёртвого 4-хопового конвейера ниже.
   */
  SYNC_STOCKS: 'sync-stocks',
  /**
   * Живая сводка FBY по кнопке: generate→поллинг отчёта Маркета занимает до
   * минут, в хендлере это стопорило polling-цикл telegraf для всех.
   */
  SEND_FBY_OVERVIEW: 'send-fby-overview',
  /**
   * Живой обзор складов по кнопке: с тех пор как под каждым складом печатаются
   * остатки, экран ждёт тот же асинхронный отчёт Маркета, что и сводка FBY, —
   * то есть минуты в цикле апдейтов telegraf.
   */
  SEND_WAREHOUSES_OVERVIEW: 'send-warehouses-overview',
  /**
   * Живой отчёт «Прибыль» по кнопке: самый дорогой из отчётов (оба набора
   * заказов оконными запросами + возвраты + калькулятор), в хендлере он
   * держал polling-цикл telegraf на десятки секунд.
   */
  SEND_PROFIT_REPORT: 'send-profit-report',
  /**
   * Живой экран «🧮 Калькулятор» по кнопке: те же оконные запросы заказов плюс
   * каталог и сам калькулятор тарифов — на месяце это десятки секунд, и в
   * хендлере они держали polling-цикл telegraf.
   */
  SEND_TARIFF_REPORT: 'send-tariff-report',
  /**
   * Живой отчёт «💳 Платежи» по кнопке: united-netting — асинхронный отчёт
   * Маркета (generate → поллинг, минуты), ожидание в хендлере стопорило бы
   * polling-цикл telegraf для всех.
   */
  SEND_PAYMENTS_REPORT: 'send-payments-report',
  /**
   * Живой экран «🎯 Рекомендации цен» по кнопке: два постраничных прохода по
   * методу с квотой 100 запросов в минуту — десятки секунд на большом
   * каталоге, та же причина.
   */
  SEND_PRICE_RECOMMENDATIONS: 'send-price-recommendations',
  /**
   * Живой экран «🪪 Карточки»: полный обход offer-cards на большом каталоге —
   * десятки секунд, та же причина, что у рекомендаций.
   */
  SEND_OFFER_CARDS: 'send-offer-cards',
  /**
   * Живой раздел «📈 Отчёты Маркета»: шесть асинхронных отчётов Маркета
   * (generate → поллинг, минуты) — один job-тип, конкретный отчёт в payload.
   */
  SEND_MARKET_REPORT: 'send-market-report',
  /**
   * «✨ Предложить ответ» на отзыв: один запрос к Polza, ответ бывал 68 с — в
   * хендлере это держало бы polling-цикл telegraf для всех.
   */
  SEND_FEEDBACK_DRAFT: 'send-feedback-draft',
  /**
   * Напоминание об оплате хостинга — единственная рассылка «всем сразу», а не
   * ответ на действие пользователя. Задача повторяемая (28–31 числа), последний
   * ли это день месяца, решает процессор: cron такого не выражает.
   */
  SEND_HOSTING_REMINDER: 'send-hosting-reminder',
  /** Любая фоновая задача CRM; что именно считать — `kind` в payload. */
  RUN_CRM_JOB: 'run-crm-job',
  /** Импорт журнала ЯМ за период; payload — продавец и даты, без токена. */
  IMPORT_FINANCE: 'import-finance',
  /** Проверка уведомлений продавца; payload — продавец и вид запуска, без токена. */
  CHECK_SELLER_NOTIFICATIONS: 'check-seller-notifications',
  /** Еженедельная ИИ-сводка продавцу; payload — продавец и вид запуска, без токена. */
  SEND_AI_WEEKLY_DIGEST: 'send-ai-weekly-digest',
  PROCESS_FILE: 'process-file',
  PARSE_FILE: 'parse-file',
  COMPARE_DATA: 'compare-data',
  FETCH_YANDEX_DATA: 'fetch-yandex-data',
  UPDATE_YANDEX_OFFERS: 'update-yandex-offers',
  SEND_PROGRESS: 'send-progress',
  SEND_COMPLETION: 'send-completion',
  SEND_ERROR: 'send-error',
  SEND_SCHEDULED_REPORT: 'send-scheduled-report',
} as const;
