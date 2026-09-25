import type { Component } from 'vue';

import {
  Boxes,
  Coins,
  FileChartColumn,
  FileSpreadsheet,
  House,
  IdCard,
  LifeBuoy,
  Mail,
  MessagesSquare,
  Package,
  Settings,
  ShieldAlert,
  Store,
  Target,
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

export interface Marketplace {
  key: string;
  label: string;
}

/** Переключатель — с одним пунктом (решение владельца 2026-09-23: другие маркетплейсы — только каркас). */
export const MARKETPLACES: Marketplace[] = [{ key: 'ym', label: 'Яндекс Маркет' }];
