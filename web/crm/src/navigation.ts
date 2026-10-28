import type { MarketplaceKey, Section, TopSection } from './navigation.sections';
import type { Component } from 'vue';

import {
  Bell,
  Boxes,
  Calculator,
  ChartColumn,
  ChartPie,
  Scale,
  Coins,
  Container,
  FileChartColumn,
  FileSpreadsheet,
  House,
  IdCard,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  MessagesSquare,
  Package,
  PackagePlus,
  PiggyBank,
  Plug,
  Receipt,
  ReceiptText,
  Settings,
  Shapes,
  ShieldAlert,
  Sparkles,
  Store,
  Tags,
  Target,
  TrendingUp,
  Undo2,
  Trophy,
  UserRound,
  Wallet,
  Warehouse,
} from 'lucide-vue-next';

import {
  READY_SECTIONS,
  SECTION_KIND,
  sectionName,
  sectionPath,
  sectionsOfKind,
  storeSectionPath,
} from './navigation.sections';

export type { MarketplaceKey } from './navigation.sections';

export interface NavItem {
  /** Имя маршрута — оно же ключ пункта. */
  name: string;
  path: string;
  label: string;
  icon: Component;
  /** Подзаголовок заглушки, пока раздела нет. */
  description: string;
}

interface SectionMeta {
  label: string;
  icon: Component;
  description: string;
}

/**
 * Подписи разделов; порядок ключей — порядок меню. Вид раздела (своя у площадки /
 * общий / только ЯМ) — `SECTION_KIND` в `navigation.sections.ts`: раздел без вида
 * здесь не компилируется. Подписи совпадают с ботом там, где раздел в боте уже есть.
 */
const NAV_META: Record<Section, SectionMeta> = {
  overview: {
    label: 'Обзор',
    icon: LayoutDashboard,
    description: 'Выручка, расходы и прибыль всего кабинета за любой период',
  },
  stores: {
    label: 'Магазины',
    icon: Store,
    description: 'Магазины вашего токена — откройте, чтобы увидеть отчёты',
  },
  schedule: {
    label: 'Рассылка',
    icon: Mail,
    description: 'Какие отчёты и когда присылать в Telegram',
  },
  settings: {
    label: 'Настройки',
    icon: Settings,
    description: 'Комиссия, налог, скидки по брендам и продвижение',
  },
  expenses: {
    label: 'Расходы',
    icon: Receipt,
    description: 'Аренда, зарплаты, упаковка — расходы бизнеса за период',
  },
  taxes: {
    label: 'Налоги',
    icon: Landmark,
    description: 'Режим УСН, ставка и дата признания дохода',
  },
  purchases: {
    label: 'Закупки',
    icon: PackagePlus,
    description: 'Закупки партий и уплаченные налоги',
  },
  finance: {
    label: 'Финансы',
    icon: PiggyBank,
    description: 'Прибыль по журналу Маркета, движение денег, выплаты и сверка месяца',
  },
  'unit-economics': {
    label: 'Unit-экономика',
    icon: Calculator,
    description: 'Прибыль, расходы и минимальная цена по каждому товару',
  },
  'sales-analytics': {
    label: 'Аналитика продаж',
    icon: ChartColumn,
    description: 'Выручка, заказы, средний чек и скорость продаж по времени, брендам и товарам',
  },
  'marketplaces-dashboard': {
    label: 'Площадки',
    icon: ChartPie,
    description: 'Выручка, прибыль, маржа и возвраты подключённых площадок на графиках рядом',
  },
  'marketplace-compare': {
    label: 'Сравнение площадок',
    icon: Scale,
    description:
      'Выручка, расходы и чистая прибыль Маркета, Ozon и Wildberries за один период рядом',
  },
  'sku-ratings': {
    label: 'Рейтинги товаров',
    icon: Trophy,
    description: 'ТОП-20 по выручке, прибыли и спросу, классы ABC и XYZ',
  },
  inventory: {
    label: 'Склад',
    icon: Container,
    description:
      'Остатки по товарам: свой склад, склады площадок, в пути, возвраты, стоимость и дни запаса',
  },
  'order-feed': {
    label: 'Лента заказов',
    icon: ReceiptText,
    description: 'Заказы всех площадок: этап, прибыль по журналу, расходы и история операций',
  },
  'returns-analytics': {
    label: 'Аналитика возвратов',
    icon: Undo2,
    description: 'Возвраты, процент от выкупов и потери на них по брендам, товарам и площадкам',
  },
  forecast: {
    label: 'Прогнозы',
    icon: TrendingUp,
    description:
      'Выручка, чистая, налог и поступления до конца месяца, продажи до конца года, закупки',
  },
  products: {
    label: 'Товары',
    icon: Shapes,
    description: 'Себестоимость и её история, карточки площадок, ручная правка закупа',
  },
  'price-calculator': {
    label: 'Калькулятор цен',
    icon: Tags,
    description: 'Прибыль при цене и цена для нужной прибыли — по ставкам товара',
  },
  'ai-analyst': {
    label: 'ИИ-аналитик',
    icon: Sparkles,
    description: 'Вопросы о финансах и разбор месяца — по журналу со ссылками на операции',
  },
  notifications: {
    label: 'Уведомления',
    icon: Bell,
    description: 'Продажи, расходы, остатки, возвраты, удержания и налог — правила и пороги',
  },
  dashboard: {
    label: 'Главная',
    icon: House,
    description: 'Что едет, что возвращается и прибыль месяца',
  },
  orders: {
    label: 'Отчёты',
    icon: Package,
    description: 'Уехало клиенту, выкуплено, едет обратно',
  },
  profit: {
    label: 'Прибыль',
    icon: Coins,
    description: 'Продажи за вычетом комиссии, налога и закупа; услуги Маркета по тарифам',
  },
  'price-list': {
    label: 'Прайс',
    icon: FileSpreadsheet,
    description: 'Загрузка остатков и закупочных цен, запись остатков на площадки',
  },
  quarantine: {
    label: 'Карантин цен',
    icon: ShieldAlert,
    description: 'Товары, скрытые с витрины из-за подозрительной цены',
  },
  feedback: {
    label: 'Отзывы',
    icon: MessagesSquare,
    description: 'Отзывы о товарах, которые ждут вашего ответа',
  },
  payments: {
    label: 'Платежи',
    icon: Wallet,
    description: 'Фактические перечисления Маркета — отчёт о взаиморасчётах',
  },
  'market-reports': {
    label: 'Отчёты Маркета',
    icon: FileChartColumn,
    description: 'Реализация, оборачиваемость, конкуренты, аналитика продаж и другие',
  },
  recommendations: {
    label: 'Рекомендации цен',
    icon: Target,
    description: 'Товары, цена которых выше привлекательной по оценке Маркета',
  },
  'offer-cards': {
    label: 'Карточки',
    icon: IdCard,
    description: 'Статусы и рейтинг карточек товаров, рекомендации Маркета',
  },
  fby: {
    label: 'FBY',
    icon: Boxes,
    description: 'Остатки на складе Маркета, проблемные позиции, заявки на вывоз и поставки',
  },
  warehouses: {
    label: 'Склады',
    icon: Warehouse,
    description: 'Склады Маркета с остатками и склады магазина',
  },
};

function navItem(mp: MarketplaceKey, section: Section, path: string): NavItem {
  return { name: sectionName(mp, section), path, ...NAV_META[section] };
}

/**
 * Разделы площадки уровня аккаунта (вне магазина), порядок — `NAV_META`. ЯМ — все
 * свои, общие и только-ЯМ разделы; Ozon/WB — свои готовые разделы (`/ozon/...`) и
 * общие — те же экраны `/ym/...`; разделов только ЯМ у них нет.
 */
export function navFor(mp: MarketplaceKey): NavItem[] {
  const ready = new Set<Section>(READY_SECTIONS[mp]);
  return (Object.keys(NAV_META) as Section[])
    .filter((section): section is TopSection => {
      const kind = SECTION_KIND[section];
      if (kind === 'marketplace') return ready.has(section);
      if (kind === 'account') return true;
      return kind === 'ym' && mp === 'ym';
    })
    .map((section) => navItem(mp, section, sectionPath(mp, section)));
}

/** Разделы аккаунта ЯМ — прежние `/ym/<раздел>`. */
export const MARKETPLACE_NAV: NavItem[] = navFor('ym');

/**
 * Разделы ВНУТРИ магазина (`/ym/stores/:store/<path>`): отчёты считаются по
 * магазину из адреса, а не по активному в боте. `path` — сегмент под
 * магазином; ссылки строятся по имени маршрута, ключ магазина роутер берёт из
 * текущего адреса. Разделы отдаёт `/ym/stores/:key` — по модели магазина.
 */
export const STORE_NAV: NavItem[] = sectionsOfKind('ym-store').map((section) =>
  navItem('ym', section, storeSectionPath(section)),
);

/** Не про маркетплейс — вне префикса /ym. */
export const ACCOUNT_NAV: NavItem[] = [
  {
    // Ключи всех площадок одним экраном (TASK-161): ЯМ — всем, Ozon/WB — под своими фичами.
    name: 'connections',
    path: '/connections',
    label: 'Подключения',
    icon: Plug,
    description: 'API-ключи площадок: проверка связи и замена',
  },
  {
    name: 'profile',
    path: '/profile',
    label: 'Профиль',
    icon: UserRound,
    description: 'Ваш аккаунт и магазин; смена пароля — на вкладке «Безопасность»',
  },
  {
    name: 'help',
    path: '/help',
    label: 'Помощь',
    icon: LifeBuoy,
    description: 'Справка по боту и контакт поддержки',
  },
];

/** Разделы вне магазина — у них абсолютный `path`, недостроенные получают заглушку. */
export const ACCOUNT_LEVEL_NAV: NavItem[] = [...MARKETPLACE_NAV, ...ACCOUNT_NAV];

/**
 * Пункты, которые показать: только разделы из `me.sections` (аккаунт) или
 * `sections` открытого магазина. Раскладку решает
 * сервер (тот же реестр фич, что у бота) — пункт, не названный сервером,
 * скрыт. Пока профиль не загружен (`null`), меню пустое, а не «всё подряд»:
 * мигнуть закрытым разделом хуже, чем показать меню на мгновение позже.
 */
export function visibleNav(items: NavItem[], sections: string[] | null): NavItem[] {
  if (sections === null) return [];
  const open = new Set(sections);
  return items.filter((item) => open.has(item.name));
}

export interface NavGroup {
  key: string;
  /** Подпись над группой — имя магазина; у разделов аккаунта её нет. */
  title: string | null;
  items: NavItem[];
  /** Параметры маршрута для ссылок группы: у разделов магазина — его ключ. */
  params: Record<string, string>;
}

/** Открытый в вебе магазин — то, что сайдбару нужно от его вида. */
export interface NavStore {
  key: string;
  label: string;
  sections: string[];
}

/**
 * Группы сайдбара. Блок магазина — последнего ОТКРЫТОГО, а не того, что в
 * адресе: иначе он пропадал на любой странице аккаунта («Настройки»,
 * «Профиль», сам список магазинов), и продавец видел, что пункты меню
 * «иногда исчезают». Поэтому ссылки блока несут ключ магазина явно — вне
 * `/ym/stores/:store` роутеру подставить его неоткуда.
 *
 * Блок площадки — разделы площадки из адреса (`navFor`); вне площадки и на
 * площадке «скоро» — ЯМ.
 */
export function sidebarGroups(
  marketplace: MarketplaceKey | null,
  accountSections: string[] | null,
  store: NavStore | null,
): NavGroup[] {
  // Вне площадки (профиль, помощь) и на площадке «скоро» — разделы ЯМ.
  const mp =
    marketplace !== null && isLiveMarketplace(marketplace, accountSections) ? marketplace : 'ym';
  const storeGroup: NavGroup[] =
    store === null
      ? []
      : [
          {
            key: 'store',
            title: store.label,
            items: visibleNav(STORE_NAV, store.sections),
            params: { store: store.key },
          },
        ];
  const groups: NavGroup[] = [
    ...storeGroup,
    {
      key: 'marketplace',
      title: null,
      items: visibleNav(navFor(mp), accountSections),
      params: {},
    },
    { key: 'account', title: null, items: visibleNav(ACCOUNT_NAV, accountSections), params: {} },
  ];
  // Пустая группа — лишний отступ в сайдбаре (у продавца без площадок пуст блок площадки).
  return groups.filter((group) => group.items.length > 0);
}

export interface Marketplace {
  key: MarketplaceKey;
  label: string;
  /** Куда ведёт выбор площадки в переключателе. */
  home: string;
}

/**
 * Все площадки, порядок ЯМ → Ozon → WB (решение tz_finance_scope). Подписи —
 * те же, что отдаёт `GET /api/crm/marketplaces` (общий лист бэкенда
 * `src/shared/marketplace.ts`).
 *
 * У каждой площадки свой буквальный префикс адресов — `/ym/...`, `/ozon/...`,
 * `/wb/...`, — как и у её API (решение crm_marketplace_api_segment): разделы
 * площадок разные, и общий `/:mp/settings` открывал бы разделы ЯМ под чужой
 * площадкой.
 */
export const ALL_MARKETPLACES: Marketplace[] = [
  { key: 'ym', label: 'Яндекс Маркет', home: sectionPath('ym', 'stores') },
  { key: 'ozon', label: 'Ozon', home: homeOf('ozon') },
  { key: 'wb', label: 'Wildberries', home: homeOf('wb') },
];

/** Адрес Ozon/WB в переключателе — первый готовый раздел (TASK-180: «Финансы»), без них — `/ozon`. */
function homeOf(mp: Exclude<MarketplaceKey, 'ym'>): string {
  const first = READY_SECTIONS[mp][0];
  return first ? sectionPath(mp, first) : `/${mp}`;
}

/**
 * Живая ли площадка у продавца — решает сервер, а не сборка: ЯМ открыт всегда,
 * Ozon/WB — когда сервер отдал в `me.sections` хотя бы один её готовый раздел
 * (`READY_SECTIONS`). Разделы `ozon-*`/`wb-*` сервер кладёт туда только при
 * открытой фиче площадки (`CRM_MARKETPLACE_GATE`) — то же правило, что
 * `available` в `GET /api/crm/marketplaces`, но профиль роутер уже дождался.
 * `sections === null` (профиль не загрузился) — живой только ЯМ.
 */
export function isLiveMarketplace(mp: MarketplaceKey, sections: string[] | null): boolean {
  if (mp === 'ym') return true;
  if (sections === null) return false;
  const open = new Set(sections);
  return READY_SECTIONS[mp].some((section) => open.has(sectionName(mp, section)));
}

/**
 * Живые площадки продавца. Один список — для переключателя, карточки
 * «Площадки», табов главной, сайдбара и роутера.
 */
export function liveMarketplaces(sections: string[] | null): Marketplace[] {
  return ALL_MARKETPLACES.filter((m) => isLiveMarketplace(m.key, sections));
}

/** Площадки «скоро»: их адреса ведут на страницу-заглушку (гард роутера). */
export function upcomingMarketplaces(sections: string[] | null): Marketplace[] {
  return ALL_MARKETPLACES.filter((m) => !isLiveMarketplace(m.key, sections));
}

/**
 * Куда ведёт площадка: у живой Ozon/WB — первый готовый раздел, который сервер
 * открыл (раздел может быть закрыт своей фичей); у ЯМ и площадки «скоро» —
 * статический адрес (на «скоро» его приведёт гард).
 */
export function marketplaceHome(mp: MarketplaceKey, sections: string[] | null): string {
  const fallback = ALL_MARKETPLACES.find((m) => m.key === mp)?.home ?? '/';
  if (mp === 'ym' || sections === null) return fallback;
  const open = new Set(sections);
  const first = READY_SECTIONS[mp].find((section) => open.has(sectionName(mp, section)));
  return first ? sectionPath(mp, first) : fallback;
}

/** Площадка по адресу — первый сегмент пути; вне площадки (профиль, помощь) — null. */
export function marketplaceOfPath(path: string): MarketplaceKey | null {
  const segment = path.split('/')[1] ?? '';
  return ALL_MARKETPLACES.find((m) => m.key === segment)?.key ?? null;
}
