import type { TReportKey } from '../../../yandex/reports/report-status-map';

import { parseFbCallback } from '../../../yandex/feedback/feedback.domain';
import { parseMktCallback } from '../../../yandex/market-reports/market-reports.domain';
import { parsePayCallback } from '../../../yandex/payments/payments.domain';
import { parsePqCallback } from '../../../yandex/quarantine/quarantine.domain';
import { parsePromoCallback } from '../../../yandex/reports/promo';
import { PERIOD } from '../../../yandex/reports/report-period';
import { REPORT } from '../../../yandex/reports/report-status-map';
import { isFby } from '../../../yandex/stocks/placement';
import { MENU, menuLayout } from '../price-changer-bot/menu.constants';
import {
  MENU_TO_REPORT,
  parseNotifyCallback,
  parseReportCallback,
  parseScheduleCallback,
} from '../price-changer-bot/report-buttons';

/**
 * Реестр возможностей бота и правила «кому что открыто».
 *
 * Без telegraf, без Mongo, без Nest — как соседний `access.domain.ts`, и по той
 * же причине: ошибка в этой таблице не даёт ни ошибки компиляции, ни падения в
 * рантайме. Гейт просто начинает пускать туда, куда не должен, либо кнопка
 * молча перестаёт работать. Здесь это проверяется обычными юнит-тестами.
 *
 * Чем это НЕ является. `access.domain.ts` отвечает на вопрос «пускать ли этого
 * человека в бота вообще» (статус заявки), здесь — «открыта ли ему вот эта
 * конкретная функция». Разные вопросы с разными ответами: одобренный продавец
 * может не иметь «Прибыли», а отклонённый не имеет ничего вне зависимости от
 * флагов. Сливать таблицы нельзя — правка правил доступа тихо переписывала бы
 * набор функций, и наоборот.
 */

export const FEATURE = {
  /** «🚚 Уехало клиенту» */
  REPORT_SHIPPED_TODAY: 'report_shipped_today',
  /** «✅ Выкуплено» */
  REPORT_REDEEMED: 'report_redeemed',
  /** «↩️ Едет обратно» */
  REPORT_RETURNING: 'report_returning',
  /** «📦 Едет до клиента» — выгрузка xlsx */
  REPORT_IN_TRANSIT: 'report_in_transit',
  /** «💰 Прибыль» — единственный экран с деньгами после затрат */
  REPORT_PROFIT: 'report_profit',
  /** «⏰ Рассылка» — раздел настройки и сам ежедневный дайджест */
  SCHEDULE: 'schedule',
  /**
   * Прайс документом: две НЕЗАВИСИМЫЕ половины одной загрузки. Прежний единый
   * `stock_upload` закрывал файл целиком, а админ должен уметь оставить
   * продавцу закупочные цены (кормят «Прибыль», пишутся в нашу Mongo), забрав
   * запись остатков (уходит в Partner API) — и наоборот. Старые явные записи
   * `stock_upload` в `UserAccess.features` инертны: их никто больше не читает,
   * к новым ключам применяется умолчание «включено».
   */
  PURCHASE_PRICES: 'purchase_prices',
  STOCK_UPDATE: 'stock_update',
  /** «🏬 Склады» — обзор складов по типам (FBY и склад магазина) */
  WAREHOUSES: 'warehouses',
  /** «📦 FBY» — сводка по складу Маркета: остатки, брак, заявки, доставка */
  FBY: 'fby',
  /** «📣 Продвижение» — комиссия за буст по брендам, вычитается в «Прибыли» */
  PROMOTION: 'promotion',
  /** Строка «🧮 По калькулятору Маркета» в «Прибыли» — сверка комиссии */
  TARIFF_CALC: 'tariff_calc',
  /** «🚧 Карантин цен» — товары, скрытые Маркетом, с кнопками подтверждения */
  PRICE_QUARANTINE: 'price_quarantine',
  /** «💬 Отзывы» — отзывы без ответа, ответ и «прочитано» из бота */
  GOODS_FEEDBACK: 'goods_feedback',
  /** «💳 Платежи» — отчёт по фактическим перечислениям Маркета, xlsx */
  PAYMENTS_REPORT: 'payments_report',
  /** «🎯 Рекомендации цен» — какие товары дороже привлекательной цены */
  PRICE_RECOMMENDATIONS: 'price_recommendations',
  /** «📈 Отчёты Маркета» — раздел из шести асинхронных отчётов, один флаг */
  MARKET_REPORTS: 'market_reports',
  /** «🪪 Карточки» — заполненность карточек и рекомендации Маркета */
  OFFER_CARDS: 'offer_cards',
  /**
   * История заказов глубже 30 дней (через stats/orders). Кнопки не чеканит —
   * флаг читается в ReportsHandler.run и едет в payload (паттерн TARIFF_CALC).
   */
  DEEP_HISTORY: 'deep_history',
  /**
   * Секция «поставки» в экране «📦 FBY». Тоже без кнопки: флаг СЕКЦИИ, а не
   * экрана — читается хендлером FBY и едет в payload джобы.
   */
  FBY_SUPPLY: 'fby_supply',
  /**
   * Напоминание об оплате хостинга в последний день месяца. Кнопки нет и быть
   * не может (паттерн PROMOTION): это фоновая рассылка, а не экран — гейт её не
   * разбирает, флаг читает сам процессор.
   */
  HOSTING_REMINDER: 'hosting_reminder',
  /**
   * ИИ-функции через Polza.ai. Кнопки нет (паттерн PROMOTION/HOSTING_REMINDER):
   * апдейта под фичу нет, гейт её не разбирает — флаг читает последний барьер,
   * `AiService`, получая от вызывающего уже разрешённый boolean. Глобальный
   * выключатель — `AppConfigService.polzaAiEnabled`; токен здесь не проверять.
   */
  AI: 'ai',
  /**
   * Финансовый журнал: автоматическая загрузка отчётов площадки по расписанию
   * (TASK-112). Кнопки нет (паттерн HOSTING_REMINDER): апдейта под фичу нет,
   * флаг читают планировщик загрузки и процессор очереди `finance-import`.
   * С TASK-124 — ещё и гейт раздела CRM «Финансы» (`@RequireFeature`, решение
   * `finance_crm_feature_finance`): без загруженного журнала экрану нечего показать.
   */
  FINANCE: 'finance',
  /**
   * Операционные расходы бизнеса (TASK-121): раздел CRM «Расходы». Кнопки в
   * боте нет (решение `expenses_crm_only`): записи с категориями и датами —
   * форма, а не чат, и `featureGate` закрывать нечего. Гейт — `@RequireFeature`.
   */
  EXPENSES: 'expenses',
  /**
   * Налоговые настройки продавца (TASK-123): раздел CRM «Налоги» — режим,
   * ставка, дата признания дохода. Кнопки в боте нет (решение `taxes_crm_only`),
   * `featureGate` закрывать нечего. Гейт — `@RequireFeature`.
   */
  TAXES: 'taxes',
  /**
   * Налоговый модуль ИП (TASK-146, ТЗ п.12): вкладка «Год» в CRM «Налоги» —
   * доход с начала года, налог и авансы по отчётным периодам, уменьшения на
   * взносы, лимит УСН и порог НДС, прогноз и сверка с бухгалтерией. Кнопки в
   * боте нет, `featureGate` закрывать нечего. Гейт — kind `taxes:year` и
   * `@RequireFeature(taxes, tax_year)` на маршрутах вкладки.
   */
  TAX_YEAR: 'tax_year',
  /**
   * Закупки партий и ДДС (TASK-122): раздел CRM «Закупки» — закупки, уплаченные
   * налоги, денежный поток, фактические выплаты и деньги к получению. Кнопки в
   * боте нет (решение `purchases_crm_section`), `featureGate` закрывать нечего.
   * Гейт — `@RequireFeature`.
   */
  PURCHASES: 'purchases',
  /**
   * «Обзор» (TASK-125, ТЗ п.1): главная v2 уровня аккаунта — выручка, заказы,
   * себестоимость, услуги площадки, уровни прибыли и динамика из финжурнала, плюс
   * «к получению», стоимость остатков и товары в пути. Кнопки в боте нет (решение
   * `overview_account_section`), `featureGate` закрывать нечего. Гейт —
   * `@RequireFeature`/фичи kind-ов; денежная сводка требует ещё и `finance`.
   */
  OVERVIEW: 'overview',
  /**
   * «Unit-экономика» (TASK-138, ТЗ п.7): прибыль, расходы и минимальная цена по
   * товару из финжурнала, с динамикой к прошлому периоду. Кнопки в боте нет —
   * раздел аккаунта CRM, `featureGate` закрывать нечего. Гейт —
   * `@RequireFeature`/фичи kind-а; без `finance` прибыли по товару нет.
   */
  UNIT_ECONOMICS: 'unit_economics',
  /**
   * «Аналитика продаж» (TASK-140, ТЗ п.9): выручка, заказы, штуки, средний чек и
   * скорость продаж по дням/неделям/месяцам, брендам, товарам и площадкам из
   * финжурнала. Кнопки в боте нет — раздел аккаунта CRM, `featureGate` закрывать
   * нечего. Гейт — фичи kind-а; без `finance` продаж из журнала нет.
   */
  SALES_ANALYTICS: 'sales_analytics',
  /**
   * «Сравнение площадок» (TASK-137, ТЗ п.2): P&L ЯМ, Ozon и WB за один период
   * рядом с одинаковыми правилами учёта и детерминированными выводами. Кнопки в
   * боте нет — раздел аккаунта CRM, `featureGate` закрывать нечего. Гейт — фичи
   * kind-а; без `finance` журналов нет. Колонки Ozon/WB — под своими `ozon`/`wb`.
   */
  MARKETPLACE_COMPARE: 'marketplace_compare',
  /**
   * Дашборд «Площадки» (TASK-191, решение marketplaces_dashboard): KPI и графики всех
   * подключённых открытых площадок за период рядом. Кнопки в боте нет — раздел
   * аккаунта CRM, `featureGate` закрывать нечего. Раздел виден только при ≥2
   * подключённых открытых площадках (`connectedOpenMarketplaces`). Числа — из
   * `FinanceService.compare`; без `finance` журналов нет.
   */
  MARKETPLACES_DASHBOARD: 'marketplaces_dashboard',
  /**
   * «Рейтинги и классификации» (TASK-141, ТЗ п.9): ТОП-20 товаров, ABC и XYZ из
   * финжурнала. Кнопки в боте нет — раздел аккаунта CRM, `featureGate` закрывать
   * нечего. Без `finance` рейтингов нет.
   */
  SKU_RATINGS: 'sku_ratings',
  /**
   * «Склад» (TASK-142, ТЗ п.10): по товару — свой склад из прайса, остатки
   * площадок по местам (FBS отдельно от FBY/FBO/FBW, без суммы), в пути,
   * возвраты, стоимость остатков и дни запаса. Только чтение. Кнопки в боте
   * нет — раздел аккаунта CRM, `featureGate` закрывать нечего. Скорость продаж
   * — из финжурнала, поэтому без `finance` дней запаса нет.
   */
  INVENTORY: 'inventory',
  /**
   * «Лента заказов» (TASK-144, ТЗ п.11): заказы ЯМ, Ozon и WB одним списком —
   * этап из 10, прибыль заказа = Σ его операций журнала − себестоимость,
   * расходы по статьям, история операций. Только чтение. Кнопки в боте нет —
   * раздел аккаунта CRM, `featureGate` закрывать нечего. Без `finance` прибыли нет.
   */
  ORDER_FEED: 'order_feed',
  /**
   * «Аналитика возвратов» (TASK-145, ТЗ п.11): штуки и заказы возвратов, % от
   * выкупов, сумма, обратная логистика, удержания, невозвращённые комиссии и
   * потери — по брендам, площадкам и товарам, из финжурнала. Только чтение.
   * Кнопки в боте нет — раздел аккаунта CRM, `featureGate` закрывать нечего
   * (бот показывает возвраты в пути отчётом «Едет обратно» под своей фичей).
   */
  RETURNS_ANALYTICS: 'returns_analytics',
  /**
   * «Передача остатков» (TASK-143): сквозной FBS-остаток — свой склад из
   * последнего прайса минус продажи со своего склада на всех площадках после
   * загрузки — и план «что запишем» по каждой площадке. Сама по себе только
   * читает. Кнопки в боте нет — раздел аккаунта CRM, `featureGate` закрывать нечего.
   */
  STOCK_PUSH: 'stock_push',
  /**
   * Запись плана «Передачи остатков» в Яндекс.Маркет — отдельный флаг на
   * продавца и площадку: это запись в чужой кабинет, и включает её владелец по
   * одному продавцу (решение `stock_push_ym_only_write`). Плюс `STOCK_WRITE_ENABLED`
   * и барьеры внутри функции записи. Раздела нет — кнопка на экране плана.
   */
  STOCK_PUSH_WRITE_YM: 'stock_push_write_ym',
  /**
   * Запись плана «Передачи остатков» в Ozon и WB (TASK-175) — по флагу на
   * площадку, как ЯМ: на единственный FBS-склад продавца, FBO/FBW — никогда.
   * Плюс `STOCK_WRITE_ENABLED` и барьеры внутри функции записи площадки.
   */
  STOCK_PUSH_WRITE_OZON: 'stock_push_write_ozon',
  STOCK_PUSH_WRITE_WB: 'stock_push_write_wb',
  /**
   * «Передача остатков» по расписанию (TASK-176): повторяемый проход на продавца
   * каждые 30 минут — тот же план, барьеры и запись, что у кнопки, и только на
   * площадки с открытой `stock_push_write_*`. Раздела нет — фоновая задача.
   */
  STOCK_PUSH_SCHEDULE: 'stock_push_schedule',
  /**
   * «Прогнозы» (TASK-151, ТЗ п.13): выручка, чистая, налог и поступления до конца
   * месяца, продажи до конца года, необходимые закупки — линейно по финжурналу.
   * Кнопки в боте нет — раздел аккаунта CRM, `featureGate` закрывать нечего.
   * Она же открывает ИИ-инструмент `getForecast` в чате (решение `forecast_ai_by_feature`).
   */
  FORECAST: 'forecast',
  /**
   * «Калькулятор цен» (TASK-139, ТЗ п.8): цена → прибыль и прибыль/рентабельность →
   * цена по ставкам товара из финжурнала, с правкой и сверкой с тарифом ЯМ. Не
   * путать с «🧮 Калькулятором» (`tariff_calc`, P&L периода по тарифам). Кнопки в
   * боте нет — раздел аккаунта CRM, `featureGate` закрывать нечего. Гейт — фичи
   * kind-ов; факт ставок требует ещё `finance`.
   */
  PRICE_CALCULATOR: 'price_calculator',
  /**
   * «Аномалии» финжурнала (TASK-149, M24): детерминированный детектор — скачок
   * доли комиссии, двойные начисления, нетипичная логистика на товар, штрафы,
   * нераспознанные удержания, расхождения сверки, нет закупа. Кнопки в боте нет —
   * вкладка «Финансов» в CRM, `featureGate` закрывать нечего. Гейт —
   * `@RequireFeature(finance, finance_anomalies)` на маршрутах вкладки.
   */
  FINANCE_ANOMALIES: 'finance_anomalies',
  /**
   * Ручная загрузка финотчёта (TASK-114, M16): файл united-netting из кабинета
   * (xlsx/xls/csv) ложится в журнал тем же путём, что импорт Маркета. Кнопки в
   * боте нет — вкладка «Загрузка» в CRM «Финансы», `featureGate` закрывать
   * нечего. Гейт — `@RequireFeature(finance, finance_upload)` на маршруте.
   */
  FINANCE_UPLOAD: 'finance_upload',
  /**
   * «Загрузить из Маркета» — журнал месяца по кнопке, не дожидаясь ночи: та же
   * задача очереди `finance-import`, что ночной проход, только разовая. Кнопка
   * живёт в пустом состоянии каждого экрана над журналом (CRM), в боте её нет —
   * `featureGate` закрывать нечего. Гейт — `@RequireFeature(finance, finance_pull)`.
   */
  FINANCE_PULL: 'finance_pull',
  /**
   * «Фактическая чистая» в «💰 Прибыли» (TASK-126, M18, решение
   * `finance_actual_beside_flat`): при проверенном журнале периода — чистая из
   * P&L рядом с плоской, иначе плоская с пометкой «предварительно»; плюс период
   * «Прошлый месяц» (вместе с `deep_history`). Модификатор отчёта, кнопки нет —
   * `featureGate` закрывать нечего; флаг читают хендлер, рассылка и kind CRM.
   */
  PROFIT_ACTUAL: 'profit_actual',
  /**
   * Ozon (TASK-128, M19): подключение Ozon Seller API (Client-Id + Api-Key) в CRM
   * и всё, что вырастет поверх него. Кнопки в боте нет, `featureGate` закрывать
   * нечего. Гейт — `@RequireFeature` на `crm/ozon/*`; закрытая фича прячет
   * раздел и оставляет Ozon «скоро» в списке площадок.
   */
  OZON: 'ozon',
  /**
   * Wildberries (TASK-133, M20): подключение токена WB API в CRM с проверкой
   * доступа к нужным категориям. Кнопки в боте нет, `featureGate` закрывать
   * нечего. Гейт — `@RequireFeature` на `crm/wb/*` и проверка связи на
   * «Подключениях»; закрытая фича оставляет WB «скоро».
   */
  WB: 'wb',
  /**
   * «ИИ-аналитик» (TASK-148, M24): чат с вопросами о финансах, ответы — пересказ
   * результатов инструментов `ai-tools` со ссылками на операции. Кнопки в боте
   * нет — раздел аккаунта CRM, `featureGate` закрывать нечего. Гейт —
   * `@RequireFeature` на `crm/ym/ai-analyst`; требует `ai` и `finance`.
   */
  AI_ANALYST: 'ai_analyst',
  AI_PERIOD_REVIEW: 'ai_period_review',
  /**
   * «Товары» (TASK-118, M17): раздел аккаунта CRM — список товаров с поиском и
   * брендом, карточка с историей себестоимости, ручная правка закупа, очередь
   * «не сопоставлено» с ручной привязкой. Кнопки в боте нет — `featureGate`
   * закрывать нечего. Гейт — `@RequireFeature` на `crm/ym/products`.
   */
  PRODUCTS: 'products',
  /**
   * «✨ Предложить ответ» на отзыв (TASK-167, M26): черновик от ИИ в диалоге
   * «Отзывов» CRM и в шаге ответа бота. Публикует по-прежнему только превью.
   * Своего экрана нет; гейт — `fb:ai:` в `featureGate` и `@RequireFeature` на
   * `crm/ym/feedback/draft`. Требует `goods_feedback` и `ai`.
   */
  FEEDBACK_AI_REPLY: 'feedback_ai_reply',
  /**
   * «Уведомления» (TASK-152, ТЗ п.14): правила (продажи упали, расходы выросли,
   * товар в убытке, остатки, возвраты, удержания, налоговый лимит) проверяются
   * раз в день в очереди `seller-notifications`, итог — центр уведомлений CRM.
   * Кнопки в боте нет — раздел аккаунта CRM; гейт — `@RequireFeature` на
   * `crm/ym/notifications` и проверка в процессоре. Требует `finance`.
   */
  NOTIFICATIONS: 'notifications',
  /**
   * Сводка новых уведомлений в Telegram (TASK-152, решение
   * `notifications_telegram_own_feature`) и ряд «🔔 Уведомления» в «⏰ Рассылке»
   * (вкл/время). Без неё уведомления копятся только в CRM. Требует `notifications`.
   */
  NOTIFICATIONS_TELEGRAM: 'notifications_telegram',
  /**
   * Еженедельная ИИ-сводка в Telegram (TASK-168): по понедельникам в 10:00 МСК
   * разбор прошлой недели. Кнопки нет (паттерн HOSTING_REMINDER): апдейта под
   * фичу нет, процессор рассылки перепроверяет флаг сам. Требует `ai` и `finance`.
   */
  AI_WEEKLY_DIGEST: 'ai_weekly_digest',
} as const;

export type TFeatureKey = (typeof FEATURE)[keyof typeof FEATURE];

/**
 * Ключи одним списком — для белого списка при записи и для панели.
 *
 * Строится из `Record<TFeatureKey, true>`, а НЕ из массива-литерала: массив
 * типа `TFeatureKey[]` не требует полноты, и забытый в нём член союза
 * компилятор пропускает молча. Ровно на этом уже стоил бага `DRAFT_FIELDS`
 * (TASK-052): тип расширили, массив забыли, и сохранение падало у каждого
 * пользователя. Здесь цена ошибки та же — фича, которую нельзя переключить.
 */
const FEATURE_KEY_SET: Record<TFeatureKey, true> = {
  [FEATURE.REPORT_SHIPPED_TODAY]: true,
  [FEATURE.REPORT_REDEEMED]: true,
  [FEATURE.REPORT_RETURNING]: true,
  [FEATURE.REPORT_IN_TRANSIT]: true,
  [FEATURE.REPORT_PROFIT]: true,
  [FEATURE.SCHEDULE]: true,
  [FEATURE.PURCHASE_PRICES]: true,
  [FEATURE.STOCK_UPDATE]: true,
  [FEATURE.WAREHOUSES]: true,
  [FEATURE.FBY]: true,
  [FEATURE.PROMOTION]: true,
  [FEATURE.TARIFF_CALC]: true,
  [FEATURE.PRICE_QUARANTINE]: true,
  [FEATURE.GOODS_FEEDBACK]: true,
  [FEATURE.PAYMENTS_REPORT]: true,
  [FEATURE.PRICE_RECOMMENDATIONS]: true,
  [FEATURE.MARKET_REPORTS]: true,
  [FEATURE.OFFER_CARDS]: true,
  [FEATURE.DEEP_HISTORY]: true,
  [FEATURE.FBY_SUPPLY]: true,
  [FEATURE.HOSTING_REMINDER]: true,
  [FEATURE.AI]: true,
  [FEATURE.FINANCE]: true,
  [FEATURE.EXPENSES]: true,
  [FEATURE.TAXES]: true,
  [FEATURE.TAX_YEAR]: true,
  [FEATURE.PURCHASES]: true,
  [FEATURE.OVERVIEW]: true,
  [FEATURE.UNIT_ECONOMICS]: true,
  [FEATURE.SALES_ANALYTICS]: true,
  [FEATURE.MARKETPLACE_COMPARE]: true,
  [FEATURE.MARKETPLACES_DASHBOARD]: true,
  [FEATURE.SKU_RATINGS]: true,
  [FEATURE.INVENTORY]: true,
  [FEATURE.ORDER_FEED]: true,
  [FEATURE.RETURNS_ANALYTICS]: true,
  [FEATURE.STOCK_PUSH]: true,
  [FEATURE.STOCK_PUSH_WRITE_YM]: true,
  [FEATURE.STOCK_PUSH_WRITE_OZON]: true,
  [FEATURE.STOCK_PUSH_WRITE_WB]: true,
  [FEATURE.STOCK_PUSH_SCHEDULE]: true,
  [FEATURE.FORECAST]: true,
  [FEATURE.PRICE_CALCULATOR]: true,
  [FEATURE.FINANCE_ANOMALIES]: true,
  [FEATURE.FINANCE_UPLOAD]: true,
  [FEATURE.FINANCE_PULL]: true,
  [FEATURE.PROFIT_ACTUAL]: true,
  [FEATURE.OZON]: true,
  [FEATURE.WB]: true,
  [FEATURE.AI_ANALYST]: true,
  [FEATURE.AI_PERIOD_REVIEW]: true,
  [FEATURE.PRODUCTS]: true,
  [FEATURE.FEEDBACK_AI_REPLY]: true,
  [FEATURE.NOTIFICATIONS]: true,
  [FEATURE.NOTIFICATIONS_TELEGRAM]: true,
  [FEATURE.AI_WEEKLY_DIGEST]: true,
};

export const FEATURE_KEYS = Object.keys(FEATURE_KEY_SET) as TFeatureKey[];

export interface IFeatureMeta {
  /** Подпись для панели администратора. */
  label: string;
  /** Что именно перестанет работать, если выключить. */
  description: string;
  /**
   * Состояние для пользователя, которому фичу не настраивали.
   *
   * Сейчас у всех `true`: существующие продавцы не должны ничего потерять от
   * появления флагов, и разовая миграция для этого не нужна — отсутствие
   * записи и есть дефолт. Новую, ещё не обкатанную функцию можно будет ввести
   * с `false` и включать точечно.
   */
  defaultEnabled: boolean;
  /**
   * Фичи, без которых эта не работает. Открыта, только если открыты она И все
   * её зависимости (транзитивно) — решает `isFeatureEnabled`/`isFeatureOpen`,
   * а не каждый экран: забытая в одном месте проверка зависимости — это раздел,
   * который ведёт в 403, или ИИ-кнопка при закрытом `ai` (TASK-153).
   */
  requires?: readonly TFeatureKey[];
}

/**
 * Единственный источник подписей. Панель забирает их через API, а не хранит
 * вторую копию: разъехавшиеся списки подписей — беда, ради которой в этом
 * проекте появился `menu.constants.ts`.
 */
export const FEATURE_META: Readonly<Record<TFeatureKey, IFeatureMeta>> = {
  [FEATURE.REPORT_SHIPPED_TODAY]: {
    label: MENU.SHIPPED_TODAY,
    description: 'Отчёт по заказам, переданным в доставку.',
    defaultEnabled: true,
  },
  [FEATURE.REPORT_REDEEMED]: {
    label: MENU.REDEEMED,
    description: 'Отчёт по выкупленным заказам.',
    defaultEnabled: true,
  },
  [FEATURE.REPORT_RETURNING]: {
    label: MENU.RETURNING,
    description: 'Отчёт по возвратам и невыкупам.',
    defaultEnabled: true,
  },
  [FEATURE.REPORT_IN_TRANSIT]: {
    label: MENU.IN_TRANSIT,
    description: 'Выгрузка в xlsx: что сейчас в пути к покупателю.',
    defaultEnabled: true,
  },
  [FEATURE.REPORT_PROFIT]: {
    label: MENU.PROFIT,
    description: 'Чистая прибыль: продажи минус комиссия, налог и закупка.',
    defaultEnabled: true,
  },
  [FEATURE.SCHEDULE]: {
    label: MENU.SCHEDULE,
    description: 'Ежедневная автоматическая отправка отчётов по расписанию.',
    defaultEnabled: true,
  },
  [FEATURE.PURCHASE_PRICES]: {
    label: '💾 Закуп из прайса',
    description: 'Сохранение закупочных цен из прайс-листа — без них не считается «Прибыль».',
    defaultEnabled: true,
  },
  [FEATURE.STOCK_UPDATE]: {
    label: '📥 Остатки из прайса',
    description: 'Запись остатков из прайс-листа на Яндекс.Маркет.',
    defaultEnabled: true,
  },
  [FEATURE.WAREHOUSES]: {
    label: MENU.WAREHOUSES,
    description: 'Обзор складов по типам: FBY (склад Маркета) и склады магазина.',
    // Фича с умолчанием «выключено»: новая, ещё не обкатанная — включается
    // точечно из панели тому продавцу, кому нужна. Ровно тот случай, ради
    // которого defaultEnabled и различает «нет записи» и «выключено».
    defaultEnabled: false,
  },
  [FEATURE.FBY]: {
    label: MENU.FBY,
    description: 'Сводка FBY: остатки по типам, брак/просрочка, заявки на вывоз, доставка.',
    // Тоже default-off и по той же причине — точечная выкатка. Экран небыстрый
    // (остатки из асинхронного отчёта Маркета), поэтому обкатываем на желающих.
    defaultEnabled: false,
  },
  [FEATURE.PROMOTION]: {
    // Кнопка inline-only (живёт на экране настроек), поэтому подпись не из
    // MENU — ключа в MENU у неё нет и быть не должно (правило menu-labels).
    label: '📣 Продвижение',
    description: 'Комиссия за продвижение по брендам — вычитается в отчёте «Прибыль».',
    defaultEnabled: true,
  },
  [FEATURE.TARIFF_CALC]: {
    label: MENU.TARIFF_CALC,
    description:
      'Услуги Маркета по калькулятору тарифов: отдельный экран с разбивкой ' +
      'по услугам и строка сверки в отчёте «Прибыль».',
    // Default-off: экспериментальная, включается точечно из панели. Стоит
    // 2–8 лишних запросов к Partner API на каждый показ.
    defaultEnabled: false,
  },
  [FEATURE.PRICE_QUARANTINE]: {
    label: MENU.QUARANTINE,
    description:
      'Товары, скрытые Маркетом с витрины из-за подозрительной цены, ' +
      'с кнопками подтверждения. Подтверждение пишет в Partner API.',
    // Default-off: новая, включается точечно из панели — паттерн warehouses.
    defaultEnabled: false,
  },
  [FEATURE.GOODS_FEEDBACK]: {
    label: MENU.FEEDBACK,
    description:
      'Отзывы без ответа: показать, ответить из бота, пометить прочитанным. ' +
      'Ответ публикуется на Маркете публично.',
    defaultEnabled: false,
  },
  [FEATURE.PAYMENTS_REPORT]: {
    label: MENU.PAYMENTS,
    description: 'Отчёт по фактическим перечислениям Маркета (xlsx-файл).',
    defaultEnabled: false,
  },
  [FEATURE.PRICE_RECOMMENDATIONS]: {
    label: MENU.PRICE_RECOMMENDATIONS,
    description:
      'Рекомендации Маркета по ценам: какие товары дороже «привлекательной» ' +
      'цены и на сколько.',
    defaultEnabled: false,
  },
  [FEATURE.MARKET_REPORTS]: {
    label: MENU.MARKET_REPORTS,
    description:
      'Раздел из шести отчётов Маркета xlsx-файлами: реализация, ' +
      'оборачиваемость FBY, конкурентная позиция, аналитика продаж, ' +
      'ключевые показатели, география продаж.',
    defaultEnabled: false,
  },
  [FEATURE.OFFER_CARDS]: {
    label: MENU.OFFER_CARDS,
    description: 'Заполненность карточек товаров: статусы, рейтинг и рекомендации Маркета.',
    defaultEnabled: false,
  },
  [FEATURE.DEEP_HISTORY]: {
    // Кнопки в MENU нет намеренно (паттерн PROMOTION): фича меняет поведение
    // существующих отчётов, а не добавляет экран.
    label: '🕰 История >30 дней',
    description:
      'Отчёты «Выкуплено», «Прибыль» и «Калькулятор» за периоды глубже ' +
      '30 дней — через архивный метод Маркета.',
    defaultEnabled: false,
  },
  [FEATURE.FBY_SUPPLY]: {
    // Тоже inline-only подпись: это флаг секции внутри «📦 FBY».
    label: '🚚 Поставки FBY',
    description: 'Секция заявок на поставку в сводке «📦 FBY».',
    defaultEnabled: false,
  },
  [FEATURE.HOSTING_REMINDER]: {
    // Inline-only подпись: экрана у рассылки нет.
    label: '💳 Напоминание об оплате',
    description:
      'Сообщение «не забудьте оплатить хостинг» в последний день месяца — ' +
      'одобренным продавцам с подключённым магазином.',
    // ВКЛЮЧЕНА по умолчанию, в отличие от последних десяти возможностей.
    // Те вводились выключенными, потому что были не обкатаны и стоили запросов
    // к Partner API; эта не ходит наружу вовсе и нужна как раз всем сразу —
    // закрывается точечно тому, с кем об оплате договорились иначе.
    defaultEnabled: true,
  },
  [FEATURE.AI]: {
    // Inline-only подпись: своего экрана у фичи нет, она открывает ИИ внутри других.
    label: '🤖 ИИ-функции (Polza.ai)',
    description:
      'ИИ-возможности бота и CRM. Запросы идут через ключ Polza.ai владельца ' +
      'и стоят денег — работают, только если ИИ включён на сервере.',
    // Выключена: каждый запрос оплачивает владелец из одного общего ключа,
    // поэтому ИИ открывается продавцам по одному из панели.
    defaultEnabled: false,
  },
  [FEATURE.FINANCE]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '📒 Финансы',
    description:
      'Ежедневная загрузка финансового журнала площадки и раздел CRM «Финансы»: ' +
      'уровни прибыли, статьи до операций и оригинала отчёта, ДДС, выплаты, ' +
      'статус периода и расхождения.',
    // Выключена: каждая загрузка — генерация отчёта из часовой квоты Маркета,
    // а журнал ещё не обкатан на живых продавцах (правило
    // new_functions_behind_feature).
    defaultEnabled: false,
  },
  [FEATURE.EXPENSES]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🧾 Расходы бизнеса',
    description:
      'Операционные расходы продавца в CRM: аренда, зарплаты, упаковка и свои категории — ' +
      'разовые и ежемесячные, с распределением на период.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
  },
  [FEATURE.TAXES]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🏛 Налоги',
    description:
      'Налоговые настройки продавца в CRM: режим УСН, ставка и дата признания дохода — ' +
      'база налога для финансового отчёта.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
  },
  [FEATURE.TAX_YEAR]: {
    // Inline-only подпись: кнопки в боте нет, вкладка живёт в CRM «Налоги».
    label: '📅 Налоговый год',
    description:
      'Налоговый модуль ИП в CRM «Налоги»: доход с начала года до комиссий, налог и авансы ' +
      'по отчётным периодам, уменьшение на взносы, лимит УСН и порог НДС, прогноз года, ' +
      'сверка с бухгалтерией.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Без настроек налога вкладки нет, без журнала — дохода (решение tax_year_feature).
    requires: [FEATURE.TAXES, FEATURE.FINANCE],
  },
  [FEATURE.PURCHASES]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '📦 Закупки и ДДС',
    description:
      'Закупки партий и уплаченные налоги в CRM, денежный поток периода, фактические выплаты ' +
      'Маркета и деньги к получению. На чистую прибыль закупка не влияет.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
  },
  [FEATURE.UNIT_ECONOMICS]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🧮 Unit-экономика',
    description:
      'Прибыль по каждому товару из финжурнала: средняя цена, себестоимость, комиссия, ' +
      'логистика, продвижение, налог, рентабельность, минимальная цена без убытка и ' +
      'динамика к прошлому периоду. Работает только вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Прибыль по товару целиком из финжурнала: без него экран пуст.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.SALES_ANALYTICS]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '📊 Аналитика продаж',
    description:
      'Выручка, заказы, штуки, средний чек и скорость продаж по дням, неделям и месяцам, ' +
      'по брендам, товарам и площадкам, с динамикой к прошлому периоду. Работает только ' +
      'вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Продажи берутся из финжурнала: без него экран пуст.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.MARKETPLACE_COMPARE]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '⚖️ Сравнение площадок',
    description:
      'Выручка, расходы, возвраты и чистая прибыль Яндекс Маркета, Ozon и Wildberries за один ' +
      'период рядом, с выводами, где выгоднее. Работает только вместе с «Финансами»; колонки ' +
      'Ozon и Wildberries — при открытых функциях этих площадок.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Сравниваются финжурналы площадок: без них экран пуст.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.MARKETPLACES_DASHBOARD]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '📊 Площадки',
    description:
      'Дашборд со сравнением подключённых площадок на графиках: выручка во времени, прибыль, маржа, ' +
      'доля в выручке и возвраты за один период. Виден, когда подключено больше одной площадки; ' +
      'работает только вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Числа — из финжурналов площадок (FinanceService.compare): без них экран пуст.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.INVENTORY]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '📦 Склад',
    description:
      'Остатки по каждому товару: свой склад из прайса, склады площадок, в пути к покупателю, ' +
      'возвраты, стоимость остатков по себестоимости и на сколько дней хватит. Только чтение. ' +
      'Работает только вместе с «Финансами»; Ozon и Wildberries — при открытых функциях площадок.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Скорость продаж — из финжурнала: без него дней запаса нет.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.ORDER_FEED]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🧾 Лента заказов',
    description:
      'Заказы Яндекс Маркета, Ozon и Wildberries одним списком: этап, прибыль заказа по операциям ' +
      'финжурнала за вычетом себестоимости, расходы по статьям и история операций. Только чтение. ' +
      'Работает только вместе с «Финансами»; Ozon и Wildberries — при открытых функциях площадок.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Прибыль заказа — из финжурнала: без него экрану нечего считать.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.RETURNS_ANALYTICS]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '↩️ Аналитика возвратов',
    description:
      'Возвраты за период по финжурналу: штуки и заказы, процент от выкупов, сумма возвращённых ' +
      'товаров, обратная логистика, удержания, невозвращённые комиссии и потери — по брендам, ' +
      'площадкам и товарам. Только чтение. Работает только вместе с «Финансами»; Ozon и ' +
      'Wildberries — при открытых функциях площадок.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Возвраты и их расходы — из финжурнала: без него экрану нечего считать.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.STOCK_PUSH]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🔁 Передача остатков',
    description:
      'Сквозной остаток своего склада: остаток из последнего прайса минус продажи со своего склада ' +
      'на всех площадках после загрузки, и план — какие остатки и куда будут записаны. Сама ' +
      'функция ничего не пишет: запись на каждую площадку — отдельной функцией.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
  },
  [FEATURE.STOCK_PUSH_WRITE_YM]: {
    // Inline-only подпись: отдельного раздела нет, кнопка на экране плана.
    label: '✍️ Запись остатков в Маркет',
    description:
      'Кнопка «Записать в Яндекс.Маркет» на экране «Передача остатков»: план записывается на ' +
      'склады продавца (FBS/DBS/Экспресс; FBY — никогда). Это запись в кабинет продавца — ' +
      'открывать только с его согласия.',
    // Выключена: запись в чужой кабинет включает владелец по одному продавцу.
    defaultEnabled: false,
    requires: [FEATURE.STOCK_PUSH],
  },
  [FEATURE.STOCK_PUSH_WRITE_OZON]: {
    // Inline-only подпись: отдельного раздела нет, кнопка на экране плана.
    label: '✍️ Запись остатков в Ozon',
    description:
      'Запись плана «Передачи остатков» в Ozon: на единственный рабочий склад продавца (FBS/rFBS; ' +
      'FBO — никогда; складов несколько — не пишется). Это запись в кабинет продавца — открывать ' +
      'только с его согласия.',
    // Выключена: запись в чужой кабинет включает владелец по одному продавцу.
    defaultEnabled: false,
    requires: [FEATURE.STOCK_PUSH, FEATURE.OZON],
  },
  [FEATURE.STOCK_PUSH_WRITE_WB]: {
    // Inline-only подпись: отдельного раздела нет, кнопка на экране плана.
    label: '✍️ Запись остатков в WB',
    description:
      'Запись плана «Передачи остатков» в Wildberries: на единственный FBS-склад продавца ' +
      '(FBW — никогда; складов несколько — не пишется; карточки с несколькими размерами не ' +
      'трогаются). Это запись в кабинет продавца — открывать только с его согласия.',
    // Выключена: запись в чужой кабинет включает владелец по одному продавцу.
    defaultEnabled: false,
    requires: [FEATURE.STOCK_PUSH, FEATURE.WB],
  },
  [FEATURE.STOCK_PUSH_SCHEDULE]: {
    // Inline-only подпись: раздела нет, это фоновая задача.
    label: '⏱ Передача остатков по расписанию',
    description:
      'Каждые 30 минут план «Передачи остатков» пересчитывается и записывается сам, без кнопки: ' +
      'продажа на одной площадке доходит до остальных. Пишет только на площадки с открытой записью ' +
      'остатков, с теми же барьерами; при блокировке — алерт администраторам. Открывать только с ' +
      'согласия продавца.',
    // Выключена: автоматическая запись в чужой кабинет включается по одному продавцу.
    defaultEnabled: false,
    requires: [FEATURE.STOCK_PUSH],
  },
  [FEATURE.SKU_RATINGS]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🏆 Рейтинги товаров',
    description:
      'ТОП-20 товаров по выручке, прибыли, штукам и рентабельности, убыточные, растущий ' +
      'и падающий спрос, классы ABC и XYZ. Работает только вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Рейтинги строятся по финжурналу: без него экран пуст.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.FORECAST]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🔮 Прогнозы',
    description:
      'Выручка, чистая, налог и поступления до конца месяца, продажи до конца года и ' +
      'необходимые закупки — линейно по последним дням. Работает только вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Прогноз строится по финжурналу: без него экран пуст.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.PRICE_CALCULATOR]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🏷 Калькулятор цен',
    description:
      'Цена → прибыль и рентабельность, обратно — цена для нужной прибыли в рублях или ' +
      'процентах. Ставки — факт товара за 30 дней из финжурнала, сверка с тарифом Маркета, ' +
      'правка руками. Факт работает вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
  },
  [FEATURE.AI_ANALYST]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🤖 ИИ-аналитик',
    description:
      'Чат с вопросами о финансах: «где заработал больше», «где выгоднее товар». ИИ ' +
      'пересказывает числа финжурнала со ссылками на операции и говорит «данных ' +
      'недостаточно» вместо догадки. Работает только вместе с «ИИ» и «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Ответ — запрос к Polza (ai), числа — из финжурнала (finance): без любого из них экрана нет.
    requires: [FEATURE.AI, FEATURE.FINANCE],
  },
  [FEATURE.AI_PERIOD_REVIEW]: {
    // Inline-only подпись: кнопки в боте нет, вкладка живёт в «ИИ-аналитике» CRM.
    label: '🧾 ИИ-разбор периода',
    description:
      'Кнопка «Разобрать период» в CRM: сколько заработано и удержано за месяц, какие статьи ' +
      'выросли, подозрительные списания, убыточные товары, почему изменились выплаты, и ' +
      'рекомендации из юнит-экономики со ссылками на данные. Работает только вместе с «ИИ» и «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Текст — запрос к Polza (ai), факты — из финжурнала (finance).
    requires: [FEATURE.AI, FEATURE.FINANCE],
  },
  [FEATURE.PRODUCTS]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🗂 Товары',
    description:
      'Товары продавца в CRM: поиск и фильтр по бренду, себестоимость и её история, карточки ' +
      'площадок, ручная правка закупа и ручная привязка несопоставленных карточек.',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
  },
  [FEATURE.FEEDBACK_AI_REPLY]: {
    // Inline-only подпись: своей кнопки меню нет — «✨» живёт в шаге ответа на отзыв.
    label: '✨ ИИ-ответ на отзыв',
    description:
      'Кнопка «Предложить ответ» в ответе на отзыв (бот и CRM): ИИ пишет вежливый черновик, ' +
      'продавец правит его и публикует прежней кнопкой превью — сам черновик не публикуется. ' +
      'Работает только вместе с «Отзывами» и «ИИ».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Черновик — запрос к Polza (ai), отзыв и публикация — экран отзывов (goods_feedback).
    requires: [FEATURE.GOODS_FEEDBACK, FEATURE.AI],
  },
  [FEATURE.NOTIFICATIONS]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🔔 Уведомления',
    description:
      'Раз в день проверяет правила: продажи резко упали, расходы или комиссия площадки выросли, ' +
      'товар в убытке, остаток мал, кончается или товар не продаётся, нужна закупка, много денег ' +
      'в остатках, возвраты выросли, подозрительные удержания, близко к налоговому лимиту. ' +
      'Итог — центр уведомлений в CRM с настройкой правил и порогов. Работает только вместе ' +
      'с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Деньги, возвраты и скорость продаж — из финжурнала: без него правилам нечего считать.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.NOTIFICATIONS_TELEGRAM]: {
    // Inline-only подпись: своей кнопки меню нет — ряд живёт в «⏰ Рассылке».
    label: '🔔 Уведомления в Telegram',
    description:
      'Сводка новых уведомлений в Telegram в выбранное продавцом время (по Москве); включить, ' +
      'выключить и сменить время — в «⏰ Рассылке» бота или в настройках уведомлений CRM. ' +
      'Работает только вместе с «Уведомлениями».',
    // Выключена: новая функция, открывается по продавцу (решение notifications_telegram_own_feature).
    defaultEnabled: false,
    requires: [FEATURE.NOTIFICATIONS],
  },
  [FEATURE.AI_WEEKLY_DIGEST]: {
    // Inline-only подпись: кнопки нет — сводка приходит сама.
    label: '🤖 ИИ-сводка недели',
    description:
      'По понедельникам в 10:00 (по Москве) — сводка прошлой недели в Telegram в 5–7 строк: ' +
      'выручка и чистая со сдвигом к позапрошлой неделе, заметно изменившиеся статьи, ' +
      'непросмотренные аномалии, убыточные товары. Числа считает сервер по журналу, ИИ только ' +
      'объясняет. Нет журнала за неделю — сводка не уходит. Работает только вместе с «ИИ» и «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Объяснение — запрос к Polza (ai), числа — финжурнал (finance).
    requires: [FEATURE.AI, FEATURE.FINANCE],
  },
  [FEATURE.FINANCE_ANOMALIES]: {
    // Inline-only подпись: кнопки в боте нет, вкладка живёт в CRM «Финансы».
    label: '🚨 Аномалии',
    description:
      'Подозрительное в финжурнале месяца: скачок доли комиссии, двойные начисления, ' +
      'дорогая логистика на товар, штрафы, нераспознанные удержания, расхождения сверки, ' +
      'товары без закупа — с порогом, ссылками на операции и отметкой «просмотрено». ' +
      'Работает только вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Вкладка «Финансов» и детектор над журналом — без него не существует.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.FINANCE_UPLOAD]: {
    // Inline-only подпись: кнопки в боте нет, вкладка живёт в CRM «Финансы».
    label: '📤 Загрузка отчётов',
    description:
      'Загрузка отчёта Маркета по платежам (united-netting) файлом xlsx, xls или csv из ' +
      'кабинета — когда отчёт не пришёл через API. Операции ложатся в финжурнал без дублей ' +
      'и ничего из загруженного Маркетом не снимают. Работает только вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Пишет в финжурнал и живёт вкладкой «Финансов» — без них её нет.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.FINANCE_PULL]: {
    // Inline-only подпись: кнопки в боте нет, она в пустых состояниях экранов CRM.
    label: '🔄 Загрузка журнала по кнопке',
    description:
      'Кнопка «Загрузить из Маркета» на экранах над финжурналом: журнал текущего или прошлого ' +
      'месяца загружается сразу, не дожидаясь ночи (не чаще раза в 15 минут на месяц). ' +
      'Работает только вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Пишет в финжурнал — без «Финансов» его некому показать.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.PROFIT_ACTUAL]: {
    // Inline-only подпись (паттерн DEEP_HISTORY): фича меняет существующий
    // отчёт «💰 Прибыль», а не добавляет экран.
    label: '📒 Фактическая чистая',
    description:
      '«💰 Прибыль»: чистая по проверенному журналу Маркета рядом с расчётом по ставкам, ' +
      'пометка «предварительно», пока месяц не сверен, и период «Прошлый месяц» ' +
      '(вместе с «Историей >30 дней»). Работает только вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
    // Число берётся из финжурнала — без загрузки журнала его нет.
    requires: [FEATURE.FINANCE],
  },
  [FEATURE.OVERVIEW]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '📊 Обзор',
    description:
      'Главная CRM по всему кабинету: выручка, заказы, средний чек, себестоимость, услуги ' +
      'площадки, уровни прибыли и динамика к прошлому периоду из финжурнала, деньги к ' +
      'получению, стоимость остатков и товары в пути. Деньги — только вместе с «Финансами».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
  },
  [FEATURE.OZON]: {
    // Inline-only подпись: кнопки в боте нет, раздел живёт в CRM.
    label: '🟦 Ozon',
    description:
      'Подключение Ozon Seller API в CRM: Client-Id и Api-Key, проверка ключа до записи. ' +
      'Пока закрыта, Ozon в списке площадок — «скоро».',
    // Выключена: новая функция, открывается по продавцу (new_functions_behind_feature).
    defaultEnabled: false,
  },
  [FEATURE.WB]: {
    // Inline-only подпись: кнопки в боте нет, карточка живёт на «Подключениях» CRM.
    label: '🟪 Wildberries',
    description:
      'Подключение токена WB API в CRM: проверка доступа к категориям до записи. ' +
      'Пока закрыта, Wildberries в списке площадок — «скоро».',
    defaultEnabled: false,
  },
};

/** Карта явных решений администратора. Отсутствие ключа — не «выключено». */
export type TFeatureMap = Record<string, boolean> | undefined;

type TFeatureRegistry<K extends string> = Readonly<Record<K, IFeatureMeta>>;

/**
 * Решение администратора по САМОЙ фиче (или её умолчание) — без зависимостей.
 * Нужно панели: тумблер ставит именно этот флаг, и покажи он действующее
 * значение, при закрытой зависимости он не сдвинулся бы с места.
 */
export function featureFlag(features: TFeatureMap, key: TFeatureKey): boolean {
  return flagIn(FEATURE_META, features, key);
}

/**
 * Открыта ли фича: её флаг И флаги всех зависимостей (`requires`, транзитивно).
 *
 * Зависимости свёрнуты сюда, а не только в `isFeatureOpen`: флаг напрямую
 * читают двадцать мест (kind-ы CRM, хендлеры, процессоры), а `resolveFeatures`
 * отдаёт снимок `features` в CRM — каждое из них иначе пришлось бы помнить.
 * Снимок, уже разрешённый этой функцией, разрешается ею же в то же самое.
 */
export function isFeatureEnabled(features: TFeatureMap, key: TFeatureKey): boolean {
  return enabledIn(FEATURE_META, features, key);
}

/**
 * Открыт ли «Прибыли» период «Прошлый месяц»: часть фичи profit_actual, и
 * начало прошлого месяца почти всегда старше 30 дней — без deep_history отчёт
 * упал бы. Одно правило на кнопку бота, проверку callback и kind CRM.
 */
export function isPrevMonthOpen(features: TFeatureMap): boolean {
  return (
    isFeatureEnabled(features, FEATURE.PROFIT_ACTUAL) &&
    isFeatureEnabled(features, FEATURE.DEEP_HISTORY)
  );
}

function flagIn<K extends string>(
  registry: TFeatureRegistry<K>,
  features: TFeatureMap,
  key: K,
): boolean {
  const explicit = features?.[key];
  return typeof explicit === 'boolean' ? explicit : registry[key].defaultEnabled;
}

/** Ядро `isFeatureEnabled` над произвольным реестром — тест подставляет свой. */
export function enabledIn<K extends string>(
  registry: TFeatureRegistry<K>,
  features: TFeatureMap,
  key: K,
): boolean {
  if (!flagIn(registry, features, key)) return false;
  return (registry[key].requires ?? []).every((dep) =>
    enabledIn(registry, features, dep as unknown as K),
  );
}

/**
 * Что не так с графом зависимостей реестра: ключ, которого нет в реестре, и
 * цикл (включая зависимость от себя). Пустой список — граф годен. Рекурсия
 * `enabledIn` на цикле ушла бы в переполнение стека, поэтому тест реестра
 * проверяет боевой `FEATURE_META` этой функцией.
 */
export function featureGraphProblems<K extends string>(registry: TFeatureRegistry<K>): string[] {
  const problems: string[] = [];
  const keys = Object.keys(registry) as K[];
  const known = new Set<string>(keys);
  for (const key of keys) {
    for (const dep of registry[key].requires ?? []) {
      if (!known.has(dep)) problems.push(`${key} требует неизвестную фичу ${dep}`);
    }
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (key: string, path: string[]): void => {
    if (state.get(key) === 'done' || !known.has(key)) return;
    if (state.get(key) === 'visiting') {
      problems.push(`цикл зависимостей: ${[...path.slice(path.indexOf(key)), key].join(' → ')}`);
      return;
    }
    state.set(key, 'visiting');
    for (const dep of registry[key as K].requires ?? []) visit(dep, [...path, key]);
    state.set(key, 'done');
  };
  for (const key of keys) visit(key, []);
  return problems;
}

/**
 * Карта «всё включено» — для раскладки администратора. `featureGate` админов
 * пропускает целиком, и клавиатура обязана говорить то же самое: прятать от
 * админа кнопку, которую бот ему разрешает, значит рассинхронизировать два
 * слоя одной проверки. Умолчания-off (например, у экранов склада Маркета)
 * админа поэтому не касаются.
 */
export function allFeaturesEnabled(): Record<string, boolean> {
  const resolved: Record<string, boolean> = {};
  for (const key of FEATURE_KEYS) resolved[key] = true;
  return resolved;
}

/** Все фичи с ДЕЙСТВУЮЩИМИ значениями (с зависимостями) — снимок для CRM и панели. */
export function resolveFeatures(features: TFeatureMap): Record<TFeatureKey, boolean> {
  const resolved = {} as Record<TFeatureKey, boolean>;
  for (const key of FEATURE_KEYS) resolved[key] = isFeatureEnabled(features, key);
  return resolved;
}

/** Собственные флаги без зависимостей — то, что ставят тумблеры панели. */
export function resolveFeatureFlags(features: TFeatureMap): Record<TFeatureKey, boolean> {
  const resolved = {} as Record<TFeatureKey, boolean>;
  for (const key of FEATURE_KEYS) resolved[key] = featureFlag(features, key);
  return resolved;
}

export function isFeatureKey(value: unknown): value is TFeatureKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FEATURE_KEY_SET, value);
}

/** Отчёт → фича. Ключи отчётов и фич совпадают, но связь объявлена явно. */
export const REPORT_TO_FEATURE: Readonly<Record<TReportKey, TFeatureKey>> = {
  [REPORT.SHIPPED_TODAY]: FEATURE.REPORT_SHIPPED_TODAY,
  [REPORT.REDEEMED]: FEATURE.REPORT_REDEEMED,
  [REPORT.RETURNING]: FEATURE.REPORT_RETURNING,
  [REPORT.IN_TRANSIT]: FEATURE.REPORT_IN_TRANSIT,
  [REPORT.PROFIT]: FEATURE.REPORT_PROFIT,
  [REPORT.TARIFF_CALC]: FEATURE.TARIFF_CALC,
};

export function featureOfReport(key: TReportKey): TFeatureKey {
  return REPORT_TO_FEATURE[key];
}

/**
 * Открыт ли отчёт, ключ которого пришёл строкой.
 *
 * Отдельно от `featureOfReport`, потому что источник бывает недоверенным:
 * `pendingReportDay` лежит в базе с прошлых версий, а callback_data правится
 * руками. Неизвестный ключ — «закрыто»: показывать нечего.
 */
export function isReportEnabled(features: TFeatureMap, reportKey: string | undefined): boolean {
  const feature = REPORT_TO_FEATURE[reportKey as TReportKey];
  return feature ? isFeatureEnabled(features, feature) : false;
}

/** Подпись кнопки меню → фича. Кнопок без фичи здесь просто нет. */
const MENU_TO_FEATURE: Readonly<Record<string, TFeatureKey>> = {
  [MENU.SHIPPED_TODAY]: FEATURE.REPORT_SHIPPED_TODAY,
  [MENU.REDEEMED]: FEATURE.REPORT_REDEEMED,
  [MENU.RETURNING]: FEATURE.REPORT_RETURNING,
  [MENU.IN_TRANSIT]: FEATURE.REPORT_IN_TRANSIT,
  [MENU.PROFIT]: FEATURE.REPORT_PROFIT,
  [MENU.TARIFF_CALC]: FEATURE.TARIFF_CALC,
  [MENU.SCHEDULE]: FEATURE.SCHEDULE,
  [MENU.WAREHOUSES]: FEATURE.WAREHOUSES,
  [MENU.FBY]: FEATURE.FBY,
  [MENU.QUARANTINE]: FEATURE.PRICE_QUARANTINE,
  [MENU.FEEDBACK]: FEATURE.GOODS_FEEDBACK,
  [MENU.PAYMENTS]: FEATURE.PAYMENTS_REPORT,
  [MENU.PRICE_RECOMMENDATIONS]: FEATURE.PRICE_RECOMMENDATIONS,
  [MENU.MARKET_REPORTS]: FEATURE.MARKET_REPORTS,
  [MENU.OFFER_CARDS]: FEATURE.OFFER_CARDS,
};

/**
 * Какие фичи нужны, чтобы этот апдейт имел право работать.
 *
 * Пустой список — «не гейтится»: /start, главное меню, настройки, справка,
 * профиль, весь онбординг и админские кнопки. Закрывать их флагом нельзя,
 * иначе пользователь запрётся снаружи собственных настроек.
 *
 * Возвращается СПИСОК, а не один ключ: `sch:on:report_profit` включает
 * ежедневную отправку «Прибыли» и требует обеих фич сразу. Одного ключа тут не
 * хватило бы, и дайджест выключённого отчёта можно было бы завести через
 * раздел рассылки.
 */
export function requiredFeatures(input: {
  text?: string;
  callbackData?: string;
  hasDocument?: boolean;
}): TFeatureKey[] {
  if (input.callbackData !== undefined) {
    const report = parseReportCallback(input.callbackData);
    if (report) {
      // «Прошлый месяц» — часть profit_actual и без архива не строится
      // (isPrevMonthOpen): старая кнопка в истории чата не обходит ни то, ни другое.
      return report.period === PERIOD.PREV_MONTH
        ? [featureOfReport(report.reportKey), FEATURE.PROFIT_ACTUAL, FEATURE.DEEP_HISTORY]
        : [featureOfReport(report.reportKey)];
    }

    const schedule = parseScheduleCallback(input.callbackData);
    if (schedule) {
      return schedule.reportKey
        ? [FEATURE.SCHEDULE, featureOfReport(schedule.reportKey)]
        : [FEATURE.SCHEDULE];
    }

    // `rate:` и `bdisc:` не гейтятся (настройки должны оставаться доступными),
    // а продвижение — гейтится: это и есть его фича, других входов у неё нет.
    if (parsePromoCallback(input.callbackData) !== null) return [FEATURE.PROMOTION];

    // Кнопки новых экранов — тот же довод, что у промо: старая inline-кнопка
    // живёт в истории чата вечно, и раскладка меню от неё не защищает.
    if (parsePqCallback(input.callbackData) !== null) return [FEATURE.PRICE_QUARANTINE];
    const fb = parseFbCallback(input.callbackData);
    // Черновик от ИИ — своя фича поверх отзывов: старая кнопка «✨» в истории
    // чата не должна звать модель, когда функцию у продавца закрыли.
    if (fb?.action === 'ai') return [FEATURE.GOODS_FEEDBACK, FEATURE.FEEDBACK_AI_REPLY];
    if (fb !== null) return [FEATURE.GOODS_FEEDBACK];
    if (parsePayCallback(input.callbackData) !== null) return [FEATURE.PAYMENTS_REPORT];
    if (parseMktCallback(input.callbackData) !== null) return [FEATURE.MARKET_REPORTS];
    // Ряд «🔔 Уведомления» в «⏰ Рассылке» (TASK-152): свой ключ, а не `schedule` —
    // старая кнопка в истории чата не меняет время уведомлений закрытой фичи.
    if (parseNotifyCallback(input.callbackData) !== null) return [FEATURE.NOTIFICATIONS_TELEGRAM];

    return [];
  }

  // Документ гейт НЕ закрывает — проверяется до текста только затем, чтобы
  // подпись («проверка») не увела апдейт в ветку «это кнопка меню». Прайс
  // делает два независимых дела (закупочные цены и остатки), каждое под своей
  // фичей, и исход бывает частичным — «разобрать файл, но не писать остатки».
  // Гейт умеет только отбить апдейт целиком, поэтому решение принимает
  // stock-upload.handler — тот же класс исключений, что pending-ответы,
  // которые гейт не видит.
  if (input.hasDocument) return [];

  const feature = input.text === undefined ? undefined : MENU_TO_FEATURE[input.text];
  return feature ? [feature] : [];
}

/**
 * Фичи, живущие только у FBY-магазина: оба экрана — про склад Маркета, и у
 * продавца на FBS/DBS/Express они пусты. Условие ВТОРОЕ, поверх флага:
 * открыто при «фича включена И активный магазин FBY».
 *
 * Объявлено по ключу фичи, а не по подписи кнопки: то же правило действует и в
 * CRM (гард `CrmJwtGuard`), где подписей бота нет. Хендлеры экранов бота
 * перепроверяют модель сами — подпись можно набрать текстом.
 */
const FBY_ONLY_FEATURES: ReadonlySet<TFeatureKey> = new Set<TFeatureKey>([
  FEATURE.WAREHOUSES,
  FEATURE.FBY,
]);

export function isFbyOnlyFeature(key: TFeatureKey): boolean {
  return FBY_ONLY_FEATURES.has(key);
}

/**
 * Открыта ли фича с учётом модели магазина — одно правило на оба канала (бот и
 * CRM). Неизвестная модель — не FBY (`isFby`): кэш `stores` пополняется фоном,
 * а повести продавца FBS в пустой экран хуже, чем показать кнопку позже.
 *
 * Про админа функция не знает: решение «админ проходит флаги» принимает
 * вызывающий, передавая `allFeaturesEnabled()`. От модели админ не
 * освобождается — экран склада Маркета пуст и для него.
 */
export function isFeatureOpen(
  features: TFeatureMap,
  key: TFeatureKey,
  placementType?: string | null,
): boolean {
  return openIn(FEATURE_META, FBY_ONLY_FEATURES, features, key, placementType);
}

/**
 * Ядро `isFeatureOpen` над произвольным реестром. Модель проверяется у фичи И
 * у каждой зависимости: функция, требующая экрана склада Маркета, на FBS так же
 * пуста, как сам экран.
 */
export function openIn<K extends string>(
  registry: TFeatureRegistry<K>,
  fbyOnly: ReadonlySet<string>,
  features: TFeatureMap,
  key: K,
  placementType?: string | null,
): boolean {
  if (fbyOnly.has(key) && !isFby(placementType)) return false;
  if (!flagIn(registry, features, key)) return false;
  return (registry[key].requires ?? []).every((dep) =>
    openIn(registry, fbyOnly, features, dep as unknown as K, placementType),
  );
}

/**
 * Раскладка меню без кнопок выключенных фич.
 *
 * Показывать кнопку, которая ответит отказом, — вести пользователя в тупик; та
 * же причина, по которой существует `MENU_LAYOUT_UNCONFIGURED`. Но на одной
 * раскладке полагаться нельзя: подпись кнопки можно прислать текстом, а старая
 * inline-кнопка живёт в истории чата вечно — поэтому есть ещё и гейт.
 *
 * `placementType` — модель активного магазина (из кэша `stores`); не-FBY и
 * неизвестная модель прячут FBY-only кнопки (см. `isFeatureOpen`).
 */
export function featureMenuLayout(features: TFeatureMap, placementType?: string): string[][] {
  return menuLayout()
    .map((row) => row.filter((label) => allowsLabel(features, label, placementType)))
    .filter((row) => row.length > 0);
}

function allowsLabel(features: TFeatureMap, label: string, placementType?: string): boolean {
  const feature = MENU_TO_FEATURE[label];
  return !feature || isFeatureOpen(features, feature, placementType);
}

/** Отчёты, доступные пользователю, в порядке главного меню. */
export function enabledReports(features: TFeatureMap): TReportKey[] {
  return Object.values(MENU_TO_REPORT).filter((key) =>
    isFeatureEnabled(features, featureOfReport(key)),
  );
}
