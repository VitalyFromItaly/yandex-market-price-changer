import type { TReportKey } from '../../../yandex/reports/report-status-map';

import { REPORT } from '../../../yandex/reports/report-status-map';
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
  /** Приём прайса документом → запись остатков в Partner API */
  STOCK_UPLOAD: 'stock_upload',
  /** «🏬 Склады» — обзор складов по типам (FBY и склад магазина) */
  WAREHOUSES: 'warehouses',
  /** «📦 FBY» — сводка по складу Маркета: остатки, брак, заявки, доставка */
  FBY: 'fby',
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
  [FEATURE.STOCK_UPLOAD]: true,
  [FEATURE.WAREHOUSES]: true,
  [FEATURE.FBY]: true,
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
  [FEATURE.STOCK_UPLOAD]: {
    label: '📥 Загрузка прайса',
    description: 'Приём прайс-листа и обновление остатков на Яндекс.Маркете.',
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
};

/** Карта явных решений администратора. Отсутствие ключа — не «выключено». */
export type TFeatureMap = Record<string, boolean> | undefined;

export function isFeatureEnabled(features: TFeatureMap, key: TFeatureKey): boolean {
  const explicit = features?.[key];
  return typeof explicit === 'boolean' ? explicit : FEATURE_META[key].defaultEnabled;
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
const REPORT_TO_FEATURE: Readonly<Record<TReportKey, TFeatureKey>> = {
  [REPORT.SHIPPED_TODAY]: FEATURE.REPORT_SHIPPED_TODAY,
  [REPORT.REDEEMED]: FEATURE.REPORT_REDEEMED,
  [REPORT.RETURNING]: FEATURE.REPORT_RETURNING,
  [REPORT.IN_TRANSIT]: FEATURE.REPORT_IN_TRANSIT,
  [REPORT.PROFIT]: FEATURE.REPORT_PROFIT,
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
  [MENU.SCHEDULE]: FEATURE.SCHEDULE,
  [MENU.WAREHOUSES]: FEATURE.WAREHOUSES,
  [MENU.FBY]: FEATURE.FBY,
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

    return [];
  }

  // Документ — единственный путь записи в Partner API. Проверяется до текста:
  // у документа бывает подпись («проверка»), и она не должна решать ничего.
  if (input.hasDocument) return [FEATURE.STOCK_UPLOAD];

  const feature = input.text === undefined ? undefined : MENU_TO_FEATURE[input.text];
  return feature ? [feature] : [];
}

/**
 * Раскладка меню без кнопок выключенных фич.
 *
 * Показывать кнопку, которая ответит отказом, — вести пользователя в тупик; та
 * же причина, по которой существует `MENU_LAYOUT_UNCONFIGURED`. Но на одной
 * раскладке полагаться нельзя: подпись кнопки можно прислать текстом, а старая
 * inline-кнопка живёт в истории чата вечно — поэтому есть ещё и гейт.
 */
export function featureMenuLayout(features: TFeatureMap): string[][] {
  return menuLayout()
    .map((row) => row.filter((label) => allowsLabel(features, label)))
    .filter((row) => row.length > 0);
}

function allowsLabel(features: TFeatureMap, label: string): boolean {
  const feature = MENU_TO_FEATURE[label];
  return !feature || isFeatureEnabled(features, feature);
}

/** Отчёты, доступные пользователю, в порядке главного меню. */
export function enabledReports(features: TFeatureMap): TReportKey[] {
  return Object.values(MENU_TO_REPORT).filter((key) =>
    isFeatureEnabled(features, featureOfReport(key)),
  );
}
