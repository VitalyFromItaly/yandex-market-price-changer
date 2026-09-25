import type { TReportKey } from '../../../yandex/reports/report-status-map';

import { parseFbCallback } from '../../../yandex/feedback/feedback.domain';
import { parseMktCallback } from '../../../yandex/market-reports/market-reports.domain';
import { parsePayCallback } from '../../../yandex/payments/payments.domain';
import { parsePqCallback } from '../../../yandex/quarantine/quarantine.domain';
import { parsePromoCallback } from '../../../yandex/reports/promo';
import { REPORT } from '../../../yandex/reports/report-status-map';
import { isFby } from '../../../yandex/stocks/placement';
import { MENU, menuLayout } from '../price-changer-bot/menu.constants';
import {
  MENU_TO_REPORT,
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
};

/** Карта явных решений администратора. Отсутствие ключа — не «выключено». */
export type TFeatureMap = Record<string, boolean> | undefined;

export function isFeatureEnabled(features: TFeatureMap, key: TFeatureKey): boolean {
  const explicit = features?.[key];
  return typeof explicit === 'boolean' ? explicit : FEATURE_META[key].defaultEnabled;
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

/** Все фичи с разрешёнными значениями — для панели и для сборки клавиатуры. */
export function resolveFeatures(features: TFeatureMap): Record<TFeatureKey, boolean> {
  const resolved = {} as Record<TFeatureKey, boolean>;
  for (const key of FEATURE_KEYS) resolved[key] = isFeatureEnabled(features, key);
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
    if (report) return [featureOfReport(report.reportKey)];

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
    if (parseFbCallback(input.callbackData) !== null) return [FEATURE.GOODS_FEEDBACK];
    if (parsePayCallback(input.callbackData) !== null) return [FEATURE.PAYMENTS_REPORT];
    if (parseMktCallback(input.callbackData) !== null) return [FEATURE.MARKET_REPORTS];

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
  if (isFbyOnlyFeature(key) && !isFby(placementType)) return false;
  return isFeatureEnabled(features, key);
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
