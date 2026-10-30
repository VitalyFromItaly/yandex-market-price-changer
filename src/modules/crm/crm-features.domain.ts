import type { TFeatureKey, TFeatureMap } from '../telegram/bots/shared/features.domain';

import {
  FEATURE,
  FEATURE_META,
  isFbyOnlyFeature,
  isFeatureKey,
  isFeatureOpen,
} from '../telegram/bots/shared/features.domain';
import { fbyOnlyScreenText, isFby } from '../yandex/stocks/placement';

/**
 * Какие разделы CRM открыты продавцу и почему закрыт маршрут.
 *
 * Чистый модуль — без Nest и Mongo, как `features.domain.ts`, чьё правило
 * (`isFeatureOpen`) здесь и применяется: закрытая в панели фича обязана
 * закрываться в обоих каналах одинаково, иначе CRM становится обходом гейта бота.
 */

/** 403: фича закрыта администратором. */
export const FEATURE_DISABLED = 'FEATURE_DISABLED';
/** 403: экран про склад Маркета, а активный магазин не FBY. */
export const FBY_ONLY = 'FBY_ONLY';

/**
 * Разделы вида «площадка» (`web/crm/src/navigation.sections.ts`, решение
 * ozon_wb_crm_variant_a): у каждой площадки свой — `ym-finance`, `ozon-finance`,
 * `wb-finance`, с теми же фичами. Раздел Ozon/WB вдобавок требует открытой фичи
 * площадки (`CRM_MARKETPLACE_GATE`). Совпадение с разделами вида `marketplace`
 * фронта пинит `crm-features.test.ts`.
 */
export const CRM_MARKETPLACE_SECTIONS = {
  // Финансы — аккаунта: журнал бизнесовый, статус и сверка — помесячно на продавца.
  finance: [FEATURE.FINANCE],
  // Обзор (главная v2) — аккаунта: деньги из бизнесового журнала, по всему кабинету.
  overview: [FEATURE.OVERVIEW],
  // Unit-экономика — аккаунта: журнал бизнесовый, товар продаётся во всех магазинах.
  'unit-economics': [FEATURE.UNIT_ECONOMICS],
  // Аналитика продаж — аккаунта: журнал бизнесовый, разрезы — по всему кабинету.
  'sales-analytics': [FEATURE.SALES_ANALYTICS],
  // Рейтинги и классификации — аккаунта: тот же бизнесовый журнал, что у аналитики продаж.
  'sku-ratings': [FEATURE.SKU_RATINGS],
  // Склад — аккаунта: товар один на все магазины и площадки, остатки сводятся к нему.
  inventory: [FEATURE.INVENTORY],
  // Лента заказов — аккаунта: заказы всех магазинов ЯМ и площадок одним списком.
  'order-feed': [FEATURE.ORDER_FEED],
  // Аналитика возвратов — аккаунта: журналы площадок бизнесовые, разрезы — по всему кабинету.
  'returns-analytics': [FEATURE.RETURNS_ANALYTICS],
  // Прогнозы — аккаунта: база — бизнесовый журнал, закупки — по всем магазинам кабинета.
  forecast: [FEATURE.FORECAST],
} as const satisfies Record<string, readonly TFeatureKey[]>;

export type TCrmMarketplaceSection = keyof typeof CRM_MARKETPLACE_SECTIONS;

/** Площадки с разделами в CRM. */
export type TCrmMarketplace = 'ym' | 'ozon' | 'wb';

/**
 * Фича, без которой разделы площадки скрыты целиком (default off): пока она
 * закрыта, Ozon/WB у продавца — «скоро». У ЯМ гейта нет.
 */
export const CRM_MARKETPLACE_GATE: Readonly<Partial<Record<TCrmMarketplace, TFeatureKey>>> = {
  ozon: FEATURE.OZON,
  wb: FEATURE.WB,
};

function marketplaceSections(mp: TCrmMarketplace): Record<string, readonly TFeatureKey[]> {
  return Object.fromEntries(
    Object.entries(CRM_MARKETPLACE_SECTIONS).map(([section, keys]) => [`${mp}-${section}`, keys]),
  );
}

/** Дашборд «Площадки» (TASK-191): виден при фиче и ≥2 подключённых открытых площадках. */
export const MARKETPLACES_DASHBOARD_SECTION = 'ym-marketplaces-dashboard';

/**
 * Раздел CRM (имя маршрута CRM) → фичи, ЛЮБОЙ из которых
 * достаточно, чтобы раздел показать. Пустой список — раздел не гейтится
 * (главная, магазин, настройки, профиль): закрыть их флагом значит запереть
 * продавца снаружи собственных настроек — тот же довод, что у бота.
 *
 * Белый список: раздел, которого здесь нет, фронт НЕ показывает. Забытая строка
 * прячет новый раздел, а не открывает закрытый — безопасное направление дрейфа.
 * Совпадение ключей с `navigation.sections.ts` фронта пинит `crm-features.test.ts`.
 */
export const CRM_SECTIONS: Readonly<Record<string, readonly TFeatureKey[]>> = {
  'ym-dashboard': [],
  'ym-orders': [
    FEATURE.REPORT_SHIPPED_TODAY,
    FEATURE.REPORT_REDEEMED,
    FEATURE.REPORT_RETURNING,
    FEATURE.REPORT_IN_TRANSIT,
  ],
  // Две вкладки — «Прибыль» и «Калькулятор»; раздел нужен, пока открыта хоть одна.
  'ym-profit': [FEATURE.REPORT_PROFIT, FEATURE.TARIFF_CALC],
  // Прайс делает независимые дела — раздел нужен, пока открыто хоть одно. С `stock_push`
  // на нём же план «Передачи остатков» и запись по выбранным площадкам (раздела у плана
  // больше нет: свой склад приходит из прайса, и два экрана одного шага путали).
  'ym-price-list': [FEATURE.PURCHASE_PRICES, FEATURE.STOCK_UPDATE, FEATURE.STOCK_PUSH],
  // Карантин бизнесовый, но раздел живёт в магазине: магазин задаёт кабинет.
  'ym-quarantine': [FEATURE.PRICE_QUARANTINE],
  // Отзывы тоже бизнесовые: магазин задаёт кабинет и токен.
  'ym-feedback': [FEATURE.GOODS_FEEDBACK],
  'ym-payments': [FEATURE.PAYMENTS_REPORT],
  // Шесть отчётов — вкладки одного раздела под одним флагом, как в боте.
  'ym-market-reports': [FEATURE.MARKET_REPORTS],
  'ym-recommendations': [FEATURE.PRICE_RECOMMENDATIONS],
  'ym-offer-cards': [FEATURE.OFFER_CARDS],
  // Оба FBY-only: на не-FBY магазине isFeatureOpen закрывает их по модели.
  'ym-fby': [FEATURE.FBY],
  'ym-warehouses': [FEATURE.WAREHOUSES],
  'ym-schedule': [FEATURE.SCHEDULE],
  'ym-stores': [],
  'ym-settings': [],
  // Расходы бизнеса — аккаунта, не магазина: аренда одна на все кабинеты.
  'ym-expenses': [FEATURE.EXPENSES],
  // Налоги — тоже аккаунта: режим и ставка у бизнеса, не у кабинета.
  'ym-taxes': [FEATURE.TAXES],
  // Закупки и ДДС — аккаунта: партия покупается на бизнес, выплаты — по кабинету целиком.
  'ym-purchases': [FEATURE.PURCHASES],
  // Сравнение площадок — аккаунта: журналы площадок бизнесовые, сравнение по кабинету.
  'ym-marketplace-compare': [FEATURE.MARKETPLACE_COMPARE],
  // Дашборд «Площадки» — аккаунта; кроме фичи нужен ≥2 подключённых открытых площадок —
  // это не фича, поэтому `/auth/me` скрывает раздел через `hidden` (TASK-191).
  [MARKETPLACES_DASHBOARD_SECTION]: [FEATURE.MARKETPLACES_DASHBOARD],
  // Калькулятор цен — аккаунта: ставки из бизнесового журнала; тариф ЯМ — по магазину задачи.
  'ym-price-calculator': [FEATURE.PRICE_CALCULATOR],
  // «Установка цен» — аккаунта: товары и закуп одни на все площадки, цены ЯМ — бизнесовые.
  'ym-price-set': [FEATURE.PRICE_SET],
  // «ИИ-аналитик» — аккаунта: журнал бизнесовый; ai и finance свёрнуты в фичу (requires).
  // Вкладки «Чат» и «Разбор периода» (TASK-150) — раздел открыт любой из них.
  'ym-ai-analyst': [FEATURE.AI_ANALYST, FEATURE.AI_PERIOD_REVIEW],
  // Товары — аккаунта: товар и его себестоимость одни на все магазины и площадки.
  'ym-products': [FEATURE.PRODUCTS],
  // Уведомления — аккаунта: правила считаются по всему кабинету и всем площадкам (TASK-152).
  'ym-notifications': [FEATURE.NOTIFICATIONS],
  // «Подключения» — аккаунта, без фичи (TASK-161, решение crm_connections_screen): ключ ЯМ
  // менять может каждый продавец; карточки Ozon/WB закрыты своими фичами внутри раздела.
  connections: [],
  profile: [],
  help: [],
  ...marketplaceSections('ym'),
  ...marketplaceSections('ozon'),
  ...marketplaceSections('wb'),
};

/**
 * Разделы продавца без единой площадки (решение crm_audience_no_platform):
 * завести первый ключ и посмотреть свой профиль. Маршруты API этих разделов
 * помечены `@AllowWithoutPlatform`, остальные `CrmJwtGuard` закрывает.
 */
export const NO_PLATFORM_SECTIONS: ReadonlySet<string> = new Set([
  'connections',
  'profile',
  'help',
]);

/**
 * Разделы ВНУТРИ магазина (`/ym/stores/:store/...`) — отчёты считаются по
 * магазину, открытому в вебе. Остальные — разделы аккаунта: ставки и скидки
 * общие на все магазины продавца, рассылка — про бота. Совпадение со
 * `STORE_NAV` фронта пинит `crm-features.test.ts`.
 */
export const CRM_STORE_SECTIONS: ReadonlySet<string> = new Set([
  'ym-dashboard',
  'ym-orders',
  'ym-profit',
  'ym-price-list',
  'ym-quarantine',
  'ym-feedback',
  'ym-payments',
  'ym-market-reports',
  'ym-recommendations',
  'ym-offer-cards',
  'ym-fby',
  'ym-warehouses',
]);

export type TSectionScope = 'account' | 'store';

/** Фича площадки, без которой раздел скрыт: `ozon-finance` → ozon; у ЯМ и общих — нет. */
function marketplaceGateOf(name: string): TFeatureKey | undefined {
  const mp = name.split('-')[0] as TCrmMarketplace;
  return CRM_MARKETPLACE_GATE[mp];
}

/**
 * Разделы, которые показать в навигации, — в порядке таблицы. `scope` сужает
 * до разделов аккаунта (`/auth/me`) или магазина (`/stores/:key`, с моделью
 * ЭТОГО магазина); без него — все. `hidden` — разделы, закрытые не фичей, а данными
 * продавца (дашборд «Площадки» при одной площадке).
 */
export function visibleSections(
  features: TFeatureMap,
  placementType?: string | null,
  scope?: TSectionScope,
  hidden: ReadonlySet<string> = new Set(),
): string[] {
  return Object.entries(CRM_SECTIONS)
    .filter(([name]) => !hidden.has(name))
    .filter(([name]) => !scope || CRM_STORE_SECTIONS.has(name) === (scope === 'store'))
    .filter(([name]) => {
      const gate = marketplaceGateOf(name);
      return gate === undefined || isFeatureOpen(features, gate, placementType);
    })
    .filter(
      ([, keys]) =>
        keys.length === 0 || keys.some((key) => isFeatureOpen(features, key, placementType)),
    )
    .map(([name]) => name);
}

export interface ICrmFeatureBlock {
  code: typeof FEATURE_DISABLED | typeof FBY_ONLY;
  message: string;
}

/**
 * Почему маршрут закрыт, или null — открыт. Нужны ВСЕ ключи (как в боте:
 * `sch:on:report_profit` требует и рассылки, и отчёта).
 *
 * Неизвестный ключ — закрыто: опечатка в декораторе не должна открывать
 * маршрут всем (довод `isReportEnabled`).
 */
export function featureBlock(
  features: TFeatureMap,
  keys: readonly string[],
  placementType?: string | null,
): ICrmFeatureBlock | null {
  for (const key of keys) {
    if (!isFeatureKey(key)) {
      return { code: FEATURE_DISABLED, message: 'Этот раздел недоступен' };
    }
    if (isFeatureOpen(features, key, placementType)) continue;

    // Модель проверяется раньше флага — как в `isFeatureOpen`: продавцу FBS
    // «напишите администратору» не поможет, поможет только смена магазина.
    if (isFbyOnlyFeature(key) && !isFby(placementType)) {
      return { code: FBY_ONLY, message: fbyOnlyScreenText(placementType, { plain: true }) };
    }
    return { code: FEATURE_DISABLED, message: featureDisabledText(key) };
  }
  return null;
}

/** Та же формулировка, что у `featureGate` бота, — без HTML. */
export function featureDisabledText(key: TFeatureKey): string {
  return (
    `🔒 Возможность «${FEATURE_META[key].label}» сейчас недоступна. ` +
    'Её открывает администратор бота. Напишите ему, если она вам нужна.'
  );
}

/** Нужна ли гварду модель магазина: только если среди ключей есть FBY-only. */
export function needsPlacement(keys: readonly string[]): boolean {
  return keys.some((key) => isFeatureKey(key) && isFbyOnlyFeature(key));
}
