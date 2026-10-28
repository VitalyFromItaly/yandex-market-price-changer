/**
 * Разделы CRM и их вид — одна таблица для навигации, роутера и бэкенд-тестов
 * (`__tests__/unit/crm-features.test.ts` импортирует этот файл и сверяет имена с
 * `CRM_SECTIONS`). Поэтому здесь нет импортов: ни `@`, ни Vue, ни иконок.
 *
 * Вид раздела (решение ozon_wb_crm_variant_a):
 * - `marketplace` — свой у каждой площадки: `/ym/finance`, `/ozon/finance`, имена
 *   `ym-finance`, `ozon-finance`; тот же экран по данным своей площадки;
 * - `account` — общий для аккаунта: один экран `/ym/<раздел>` (`ym-<раздел>`), в
 *   навигации каждой площадки ведёт на него же;
 * - `ym` — только у ЯМ (магазины, настройки, калькулятор с тарифами ЯМ);
 * - `ym-store` — только у ЯМ, внутри магазина `/ym/stores/:store/<раздел>`.
 *
 * Адреса и имена ЯМ — прежние `/ym/<раздел>`, `ym-<раздел>`.
 */
export type MarketplaceKey = 'ym' | 'ozon' | 'wb';

export type SectionKind = 'marketplace' | 'account' | 'ym' | 'ym-store';

export const MARKETPLACE_KEYS: readonly MarketplaceKey[] = ['ym', 'ozon', 'wb'];

/** Ключ раздела — он же сегмент адреса. Порядок меню задаёт `NAV_META` в `navigation.ts`. */
export const SECTION_KIND = {
  overview: 'marketplace',
  stores: 'ym',
  schedule: 'ym',
  settings: 'ym',
  expenses: 'account',
  taxes: 'account',
  purchases: 'account',
  finance: 'marketplace',
  'unit-economics': 'marketplace',
  'sales-analytics': 'marketplace',
  'marketplaces-dashboard': 'account',
  'marketplace-compare': 'account',
  'sku-ratings': 'marketplace',
  inventory: 'marketplace',
  'order-feed': 'marketplace',
  'returns-analytics': 'marketplace',
  forecast: 'marketplace',
  products: 'account',
  'price-calculator': 'ym',
  'ai-analyst': 'account',
  notifications: 'account',
  dashboard: 'ym-store',
  orders: 'ym-store',
  profit: 'ym-store',
  'price-list': 'ym-store',
  quarantine: 'ym-store',
  feedback: 'ym-store',
  payments: 'ym-store',
  'market-reports': 'ym-store',
  recommendations: 'ym-store',
  'offer-cards': 'ym-store',
  fby: 'ym-store',
  warehouses: 'ym-store',
} as const satisfies Record<string, SectionKind>;

export type Section = keyof typeof SECTION_KIND;

type SectionOfKind<K extends SectionKind> = {
  [S in Section]: (typeof SECTION_KIND)[S] extends K ? S : never;
}[Section];

export type MarketplaceSection = SectionOfKind<'marketplace'>;
export type StoreSection = SectionOfKind<'ym-store'>;
/** Разделы вне магазина — у них абсолютный адрес. */
export type TopSection = Exclude<Section, StoreSection>;

export const SECTIONS = Object.keys(SECTION_KIND) as Section[];

export function sectionsOfKind<K extends SectionKind>(kind: K): SectionOfKind<K>[] {
  return SECTIONS.filter((s): s is SectionOfKind<K> => SECTION_KIND[s] === kind);
}

/**
 * Разделы площадки, у которых уже есть экран по её данным. Живая ли площадка у
 * продавца — решает сервер (`isLiveMarketplace` в navigation.ts: готовый раздел
 * есть в `me.sections`, т. е. открыта фича площадки); без этого её адреса ведут на
 * заглушку «скоро». Открытие Ozon/WB — фичей в админке (TASK-189/190);
 * «Финансы» Ozon/WB — по журналу своей площадки (TASK-180); unit-экономика,
 * аналитика продаж и рейтинги — тоже (TASK-181); склад, лента заказов и аналитика
 * возвратов — тоже (TASK-182); главная и прогноз — тоже (TASK-183).
 */
const OZON_WB_READY: readonly MarketplaceSection[] = [
  'overview',
  'finance',
  'unit-economics',
  'sales-analytics',
  'sku-ratings',
  'inventory',
  'order-feed',
  'returns-analytics',
  'forecast',
];

export const READY_SECTIONS: Record<MarketplaceKey, readonly MarketplaceSection[]> = {
  ym: sectionsOfKind('marketplace'),
  ozon: OZON_WB_READY,
  wb: OZON_WB_READY,
};

/** Площадка, чьи адрес и имя носит раздел: своя у вида `marketplace`, иначе ЯМ. */
function ownerOf(mp: MarketplaceKey, section: Section): MarketplaceKey {
  return SECTION_KIND[section] === 'marketplace' ? mp : 'ym';
}

/** Имя маршрута раздела — оно же ключ раздела у сервера (`me.sections`). */
export function sectionName(mp: MarketplaceKey, section: Section): string {
  return `${ownerOf(mp, section)}-${section}`;
}

/** Абсолютный адрес раздела вне магазина. */
export function sectionPath(mp: MarketplaceKey, section: TopSection): string {
  return `/${ownerOf(mp, section)}/${section}`;
}

/** Сегмент раздела под `/ym/stores/:store`; главная магазина — сам магазин. */
export function storeSectionPath(section: StoreSection): string {
  return section === 'dashboard' ? '' : section;
}

/** Разделы вне площадок — без префикса. */
export const GLOBAL_NAV_NAMES = ['connections', 'profile', 'help'] as const;

/**
 * Все имена разделов, которые знает сервер: ЯМ — все, Ozon/WB — свои разделы вида
 * `marketplace` независимо от готовности (сервер отдаёт их под фичей площадки).
 */
export function allNavNames(): string[] {
  const own = MARKETPLACE_KEYS.filter((mp) => mp !== 'ym').flatMap((mp) =>
    sectionsOfKind('marketplace').map((s) => sectionName(mp, s)),
  );
  return [...SECTIONS.map((s) => sectionName('ym', s)), ...own, ...GLOBAL_NAV_NAMES];
}

/** Имена разделов внутри магазина — `CRM_STORE_SECTIONS` у сервера. */
export function storeNavNames(): string[] {
  return sectionsOfKind('ym-store').map((s) => sectionName('ym', s));
}
