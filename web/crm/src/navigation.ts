import type { Component } from 'vue';

import {
  Bell,
  Boxes,
  Calculator,
  ChartColumn,
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
  RefreshCw,
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

export interface NavItem {
  /** Имя маршрута — оно же ключ пункта. */
  name: string;
  path: string;
  label: string;
  icon: Component;
  /** Подзаголовок заглушки, пока раздела нет. */
  description: string;
}

/**
 * Разделы маркетплейса уровня аккаунта — под /ym (другие маркетплейсы пока
 * только каркас, но префикс закладывается сразу, чтобы потом не переписывать
 * ссылки). Ставки и скидки общие на все магазины, рассылка — про бота.
 * Подписи совпадают с ботом там, где раздел в боте уже есть.
 */
export const MARKETPLACE_NAV: NavItem[] = [
  {
    name: 'ym-overview',
    path: '/ym/overview',
    label: 'Обзор',
    icon: LayoutDashboard,
    description: 'Выручка, расходы и прибыль всего кабинета за любой период',
  },
  {
    name: 'ym-stores',
    path: '/ym/stores',
    label: 'Магазины',
    icon: Store,
    description: 'Магазины вашего токена — откройте, чтобы увидеть отчёты',
  },
  {
    name: 'ym-schedule',
    path: '/ym/schedule',
    label: 'Рассылка',
    icon: Mail,
    description: 'Какие отчёты и когда присылать в Telegram',
  },
  {
    name: 'ym-settings',
    path: '/ym/settings',
    label: 'Настройки',
    icon: Settings,
    description: 'Комиссия, налог, скидки по брендам и продвижение',
  },
  {
    name: 'ym-expenses',
    path: '/ym/expenses',
    label: 'Расходы',
    icon: Receipt,
    description: 'Аренда, зарплаты, упаковка — расходы бизнеса за период',
  },
  {
    name: 'ym-taxes',
    path: '/ym/taxes',
    label: 'Налоги',
    icon: Landmark,
    description: 'Режим УСН, ставка и дата признания дохода',
  },
  {
    name: 'ym-purchases',
    path: '/ym/purchases',
    label: 'Закупки',
    icon: PackagePlus,
    description: 'Закупки партий и уплаченные налоги',
  },
  {
    name: 'ym-finance',
    path: '/ym/finance',
    label: 'Финансы',
    icon: PiggyBank,
    description: 'Прибыль по журналу Маркета, движение денег, выплаты и сверка месяца',
  },
  {
    name: 'ym-unit-economics',
    path: '/ym/unit-economics',
    label: 'Unit-экономика',
    icon: Calculator,
    description: 'Прибыль, расходы и минимальная цена по каждому товару',
  },
  {
    name: 'ym-sales-analytics',
    path: '/ym/sales-analytics',
    label: 'Аналитика продаж',
    icon: ChartColumn,
    description: 'Выручка, заказы, средний чек и скорость продаж по времени, брендам и товарам',
  },
  {
    name: 'ym-marketplace-compare',
    path: '/ym/marketplace-compare',
    label: 'Сравнение площадок',
    icon: Scale,
    description:
      'Выручка, расходы и чистая прибыль Маркета, Ozon и Wildberries за один период рядом',
  },
  {
    name: 'ym-sku-ratings',
    path: '/ym/sku-ratings',
    label: 'Рейтинги товаров',
    icon: Trophy,
    description: 'ТОП-20 по выручке, прибыли и спросу, классы ABC и XYZ',
  },
  {
    name: 'ym-inventory',
    path: '/ym/inventory',
    label: 'Склад',
    icon: Container,
    description:
      'Остатки по товарам: свой склад, склады площадок, в пути, возвраты, стоимость и дни запаса',
  },
  {
    name: 'ym-order-feed',
    path: '/ym/order-feed',
    label: 'Лента заказов',
    icon: ReceiptText,
    description: 'Заказы всех площадок: этап, прибыль по журналу, расходы и история операций',
  },
  {
    name: 'ym-returns-analytics',
    path: '/ym/returns-analytics',
    label: 'Аналитика возвратов',
    icon: Undo2,
    description: 'Возвраты, процент от выкупов и потери на них по брендам, товарам и площадкам',
  },
  {
    name: 'ym-stock-push',
    path: '/ym/stock-push',
    label: 'Передача остатков',
    icon: RefreshCw,
    description: 'Свой склад минус продажи на всех площадках — и что запишем на каждую',
  },
  {
    name: 'ym-forecast',
    path: '/ym/forecast',
    label: 'Прогнозы',
    icon: TrendingUp,
    description:
      'Выручка, чистая, налог и поступления до конца месяца, продажи до конца года, закупки',
  },
  {
    name: 'ym-products',
    path: '/ym/products',
    label: 'Товары',
    icon: Shapes,
    description: 'Себестоимость и её история, карточки площадок, ручная правка закупа',
  },
  {
    name: 'ym-price-calculator',
    path: '/ym/price-calculator',
    label: 'Калькулятор цен',
    icon: Tags,
    description: 'Прибыль при цене и цена для нужной прибыли — по ставкам товара',
  },
  {
    name: 'ym-ai-analyst',
    path: '/ym/ai-analyst',
    label: 'ИИ-аналитик',
    icon: Sparkles,
    description: 'Вопросы о финансах и разбор месяца — по журналу со ссылками на операции',
  },
  {
    name: 'ym-notifications',
    path: '/ym/notifications',
    label: 'Уведомления',
    icon: Bell,
    description: 'Продажи, расходы, остатки, возвраты, удержания и налог — правила и пороги',
  },
];

/**
 * Разделы ВНУТРИ магазина (`/ym/stores/:store/<path>`): отчёты считаются по
 * магазину из адреса, а не по активному в боте. `path` — сегмент под
 * магазином; ссылки строятся по имени маршрута, ключ магазина роутер берёт из
 * текущего адреса. Разделы отдаёт `/ym/stores/:key` — по модели магазина.
 */
export const STORE_NAV: NavItem[] = [
  {
    name: 'ym-dashboard',
    path: '',
    label: 'Главная',
    icon: House,
    description: 'Что едет, что возвращается и прибыль месяца',
  },
  {
    name: 'ym-orders',
    path: 'orders',
    label: 'Отчёты',
    icon: Package,
    description: 'Уехало клиенту, выкуплено, едет обратно',
  },
  {
    name: 'ym-profit',
    path: 'profit',
    label: 'Прибыль',
    icon: Coins,
    description: 'Продажи за вычетом комиссии, налога и закупа; услуги Маркета по тарифам',
  },
  {
    name: 'ym-price-list',
    path: 'price-list',
    label: 'Прайс',
    icon: FileSpreadsheet,
    description: 'Загрузка остатков и закупочных цен',
  },
  {
    name: 'ym-quarantine',
    path: 'quarantine',
    label: 'Карантин цен',
    icon: ShieldAlert,
    description: 'Товары, скрытые с витрины из-за подозрительной цены',
  },
  {
    name: 'ym-feedback',
    path: 'feedback',
    label: 'Отзывы',
    icon: MessagesSquare,
    description: 'Отзывы о товарах, которые ждут вашего ответа',
  },
  {
    name: 'ym-payments',
    path: 'payments',
    label: 'Платежи',
    icon: Wallet,
    description: 'Фактические перечисления Маркета — отчёт о взаиморасчётах',
  },
  {
    name: 'ym-market-reports',
    path: 'market-reports',
    label: 'Отчёты Маркета',
    icon: FileChartColumn,
    description: 'Реализация, оборачиваемость, конкуренты, аналитика продаж и другие',
  },
  {
    name: 'ym-recommendations',
    path: 'recommendations',
    label: 'Рекомендации цен',
    icon: Target,
    description: 'Товары, цена которых выше привлекательной по оценке Маркета',
  },
  {
    name: 'ym-offer-cards',
    path: 'offer-cards',
    label: 'Карточки',
    icon: IdCard,
    description: 'Статусы и рейтинг карточек товаров, рекомендации Маркета',
  },
  {
    name: 'ym-fby',
    path: 'fby',
    label: 'FBY',
    icon: Boxes,
    description: 'Остатки на складе Маркета, проблемные позиции, заявки на вывоз и поставки',
  },
  {
    name: 'ym-warehouses',
    path: 'warehouses',
    label: 'Склады',
    icon: Warehouse,
    description: 'Склады Маркета с остатками и склады магазина',
  },
];

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
 */
export function sidebarGroups(
  accountSections: string[] | null,
  store: NavStore | null,
): NavGroup[] {
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
  return [
    ...storeGroup,
    {
      key: 'marketplace',
      title: null,
      items: visibleNav(MARKETPLACE_NAV, accountSections),
      params: {},
    },
    { key: 'account', title: null, items: visibleNav(ACCOUNT_NAV, accountSections), params: {} },
  ];
}

export type MarketplaceKey = 'ym' | 'ozon' | 'wb';

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
  { key: 'ym', label: 'Яндекс Маркет', home: '/ym/stores' },
  { key: 'ozon', label: 'Ozon', home: '/ozon' },
  { key: 'wb', label: 'Wildberries', home: '/wb' },
];

/**
 * Площадки, у которых в CRM уже есть разделы. Это факт сборки фронта, а не
 * продавца: подключена ли площадка у него — говорит сервер.
 */
const LIVE_MARKETPLACES: ReadonlySet<MarketplaceKey> = new Set<MarketplaceKey>(['ym']);

export const MARKETPLACES: Marketplace[] = ALL_MARKETPLACES.filter((m) =>
  LIVE_MARKETPLACES.has(m.key),
);

/**
 * Площадки «скоро»: адрес `/ozon`, `/wb` открывает их страницу-заглушку, а не
 * разделы ЯМ. Один список — для табов главной, сайдбара и роутера.
 */
export const UPCOMING_MARKETPLACES: Marketplace[] = ALL_MARKETPLACES.filter(
  (m) => !LIVE_MARKETPLACES.has(m.key),
);

/** Площадка по адресу — первый сегмент пути; вне площадки (профиль, помощь) — null. */
export function marketplaceOfPath(path: string): MarketplaceKey | null {
  const segment = path.split('/')[1] ?? '';
  return ALL_MARKETPLACES.find((m) => m.key === segment)?.key ?? null;
}
