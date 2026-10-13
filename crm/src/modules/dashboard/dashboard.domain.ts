import type { IconTone } from './dashboard-tones.domain';
import type { PeriodKey, ReportPeriod } from '@/shared/period';
import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

import { FBY_JOB_KIND } from '@/modules/fby/fby.domain';
import { ORDER_REPORT, ordersJobKind } from '@/modules/orders/orders.domain';
import { PROFIT_REPORT, profitJobKind } from '@/modules/profit/profit.domain';
import { PERIOD, PERIOD_LABEL } from '@/shared/period';

/**
 * «Главная»: ряд KPI-карточек из тех же фоновых задач, что страницы отчётов
 * (`profit:profit`, `orders:*`, `fby:overview`), — своего kind и своих формул у
 * главной нет. Источник (задача) и карточка — разные вещи: пять денежных
 * карточек читают ОДИН отчёт «Прибыль», и ставить его пять раз незачем.
 * Каждый источник грузится сам: медленная прибыль не держит остальные.
 */

export const DASHBOARD_ROUTE_NAME = 'ym-dashboard';

// --- период -----------------------------------------------------------------

/**
 * Общий период главной — календарные периоды бота, а не скользящие «7/30 дней»
 * со скрина-образца (решение crm_dashboard_markethub): карточка ведёт в отчёт
 * с тем же периодом, и окна обязаны совпадать. «Другой день» и «Всего» — дело
 * страниц отчётов.
 */
export const DASHBOARD_PERIODS = [PERIOD.TODAY, PERIOD.WEEK, PERIOD.MONTH] as const;

export type DashboardPeriodKey = (typeof DASHBOARD_PERIODS)[number];

/** «С 1 числа» — как прежняя плитка прибыли: день слишком шумный для первого взгляда. */
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriodKey = PERIOD.MONTH;

/** Короткие подписи для шапки — полные («С 1 числа месяца») не влезают в ряд на телефоне. */
const SHORT_LABEL: Partial<Record<PeriodKey, string>> = {
  [PERIOD.WEEK]: 'Неделя',
  [PERIOD.MONTH]: 'С 1 числа',
};

export const DASHBOARD_PERIOD_OPTIONS = DASHBOARD_PERIODS.map((key) => ({
  value: key,
  label: SHORT_LABEL[key] ?? PERIOD_LABEL[key],
}));

export function isDashboardPeriod(value: unknown): value is DashboardPeriodKey {
  return (DASHBOARD_PERIODS as readonly unknown[]).includes(value);
}

export function dashboardPeriod(key: DashboardPeriodKey): ReportPeriod {
  return { key, day: null };
}

// --- источники --------------------------------------------------------------

/** Kind остатков по товарам (бэкенд `crm-stocks.domain.ts`). */
export const STOCKS_JOB_KIND = 'stocks:by-sku';

export const SOURCE = {
  PROFIT: 'profit',
  IN_TRANSIT: 'in_transit',
  RETURNING: 'returning',
  REDEEMED: 'redeemed',
  FBY: 'fby',
  STOCKS: 'stocks',
} as const;

export type SourceKey = (typeof SOURCE)[keyof typeof SOURCE];

export interface SourceMeta {
  key: SourceKey;
  /**
   * Чем открыт: фича из `/auth/me` или раздел из вида магазина. Раздел — для
   * FBY: там к фиче добавляется модель ОТКРЫТОГО магазина, и решает её сервер.
   * Закрытый источник задачу не ставит — гейт ответил бы 403.
   */
  open: { feature: string } | { section: string };
  kind: string;
  /** Ключ отчёта в ответе (сверка эха); null — у ответа ключа нет (FBY). */
  report: string | null;
  /**
   * Период задачи: `'dashboard'` — общий период главной, объект — свой
   * постоянный (возвраты в пути — «Всего»), null — срез без периода.
   */
  period: 'dashboard' | ReportPeriod | null;
  /**
   * Подпись на время сборки. У каждого источника своя: одни полоски-скелетоны
   * читаются как пустая карточка, а задача может стоять в очереди секунды.
   */
  loadingText: string;
}

/**
 * «Едет обратно» — «Всего»: без периода отчёт отдаёт возвраты в пути, то самое
 * число кабинета. Возвраты и заказы в пути — срезы «сейчас», общий период их
 * не касается, и карточка это пишет.
 */
export const SOURCES: readonly SourceMeta[] = [
  {
    key: SOURCE.PROFIT,
    open: { feature: 'report_profit' },
    kind: profitJobKind(PROFIT_REPORT.PROFIT),
    report: PROFIT_REPORT.PROFIT,
    period: 'dashboard',
    loadingText: 'Считаю заказы, закуп и возвраты…',
  },
  {
    key: SOURCE.IN_TRANSIT,
    open: { feature: 'report_in_transit' },
    kind: ordersJobKind(ORDER_REPORT.IN_TRANSIT),
    report: ORDER_REPORT.IN_TRANSIT,
    period: null,
    loadingText: 'Собираю заказы в доставке…',
  },
  {
    key: SOURCE.RETURNING,
    open: { feature: 'report_returning' },
    kind: ordersJobKind(ORDER_REPORT.RETURNING),
    report: ORDER_REPORT.RETURNING,
    period: { key: PERIOD.ALL, day: null },
    loadingText: 'Собираю возвраты в пути…',
  },
  {
    key: SOURCE.REDEEMED,
    open: { feature: 'report_redeemed' },
    kind: ordersJobKind(ORDER_REPORT.REDEEMED),
    report: ORDER_REPORT.REDEEMED,
    period: 'dashboard',
    loadingText: 'Собираю выкупленные заказы…',
  },
  {
    key: SOURCE.FBY,
    open: { section: 'ym-fby' },
    kind: FBY_JOB_KIND,
    report: null,
    period: null,
    loadingText: 'Жду отчёт остатков Маркета…',
  },
  {
    // Остаток по товарам для «Топа» и «На исходе» — срез «сейчас», под той же
    // фичей, что топ: без него эти числа не показываются.
    key: SOURCE.STOCKS,
    open: { feature: 'report_profit' },
    kind: STOCKS_JOB_KIND,
    report: null,
    period: null,
    loadingText: 'Собираю остатки по товарам…',
  },
];

/** Период, с которым источник ставится сейчас. */
export function sourcePeriod(meta: SourceMeta, current: DashboardPeriodKey): ReportPeriod | null {
  return meta.period === 'dashboard' ? dashboardPeriod(current) : meta.period;
}

// --- карточки ---------------------------------------------------------------

export const KPI = {
  SALES: 'sales',
  COMMISSION: 'commission',
  TAX: 'tax',
  PURCHASE: 'purchase',
  NET: 'net',
  IN_TRANSIT: 'in_transit',
  RETURNING: 'returning',
  STOCK: 'stock',
} as const;

export type KpiKey = (typeof KPI)[keyof typeof KPI];

export interface KpiMeta {
  key: KpiKey;
  label: string;
  source: SourceKey;
  /** Куда ведёт карточка: маршрут раздела и вкладка (ключ отчёта). */
  route: string;
  report: string | null;
  iconTone: IconTone;
  /** Итоговая карточка — подсвечена, как «Чистая прибыль» на образце. */
  accent?: boolean;
}

/** Порядок — цепочка «Прибыли» (продажи → минусы → чистая), затем срезы. */
export const KPIS: readonly KpiMeta[] = [
  {
    key: KPI.SALES,
    iconTone: 'blue',
    label: 'Продажи',
    source: SOURCE.PROFIT,
    route: 'ym-profit',
    report: 'profit',
  },
  {
    key: KPI.COMMISSION,
    iconTone: 'danger',
    label: 'Комиссия',
    source: SOURCE.PROFIT,
    route: 'ym-profit',
    report: 'profit',
  },
  {
    key: KPI.TAX,
    iconTone: 'violet',
    label: 'Налог',
    source: SOURCE.PROFIT,
    route: 'ym-profit',
    report: 'profit',
  },
  {
    key: KPI.PURCHASE,
    iconTone: 'orange',
    label: 'Закуп',
    source: SOURCE.PROFIT,
    route: 'ym-profit',
    report: 'profit',
  },
  {
    key: KPI.NET,
    iconTone: 'ok',
    label: 'Чистая прибыль',
    source: SOURCE.PROFIT,
    route: 'ym-profit',
    report: 'profit',
    accent: true,
  },
  {
    key: KPI.IN_TRANSIT,
    iconTone: 'blue',
    label: 'Едет до клиента',
    source: SOURCE.IN_TRANSIT,
    route: 'ym-orders',
    report: ORDER_REPORT.IN_TRANSIT,
  },
  {
    key: KPI.RETURNING,
    iconTone: 'danger',
    label: 'Едет обратно',
    source: SOURCE.RETURNING,
    route: 'ym-orders',
    report: ORDER_REPORT.RETURNING,
  },
  {
    key: KPI.STOCK,
    iconTone: 'amber',
    label: 'Остатки FBY',
    source: SOURCE.FBY,
    route: 'ym-fby',
    report: null,
  },
];

// --- график -----------------------------------------------------------------

/**
 * График «Выручка и чистая прибыль» — тот же источник и та же ссылка, что у
 * карточек «Продажи»/«Чистая»: второй задачи «Прибыли» главная не ставит.
 */
export const PROFIT_CHART = {
  source: SOURCE.PROFIT,
  route: 'ym-profit',
  report: 'profit',
} as const satisfies Pick<KpiMeta, 'source' | 'route' | 'report'>;

/** За «Сегодня» ряд — одна точка: это число, а не динамика, и оно уже в карточках. */
export function profitChartVisible(period: DashboardPeriodKey): boolean {
  return period !== PERIOD.TODAY;
}

export type KpiTone = 'neutral' | 'ok' | 'danger';

/** Модель карточки — готовые к показу строки; числа посчитал бэкенд. */
export interface KpiSummary {
  /** Крупное число: «42», «12 345 ₽», «1 482 шт.». */
  value: string;
  /** Подпись под числом: «23% от продаж», «на 1 234 ₽». */
  caption: string | null;
  /** «с 01-10-2026 по 13-10-2026» / «на 13-10-2026 10:00 МСК». */
  heading: string | null;
  /** Нечего показывать — хороший пустой день, а не «нет данных». */
  empty: boolean;
  emptyText: string;
  tone: KpiTone;
}

// --- блок «Заказы» ----------------------------------------------------------

/**
 * Строки блока «Заказы» (образец MarketHub). Источник ≠ строка, как у карточек:
 * «Оформлено» и «Отменено» читают уже загруженную «Прибыль», «Едет к клиенту» и
 * «Едет обратно» — те же срезы, что карточки ряда. Своя задача только у
 * «Выкуплено».
 */
export const ORDER_ROW = {
  PLACED: 'placed',
  IN_TRANSIT: 'in_transit',
  REDEEMED: 'redeemed',
  RETURNING: 'returning',
  CANCELLED: 'cancelled',
} as const;

export type OrderRowKey = (typeof ORDER_ROW)[keyof typeof ORDER_ROW];

export interface OrderRowMeta {
  key: OrderRowKey;
  label: string;
  source: SourceKey;
  /** Куда ведёт строка: маршрут раздела и вкладка (ключ отчёта). */
  route: string;
  report: string | null;
  iconTone: IconTone;
}

export const ORDER_ROWS: readonly OrderRowMeta[] = [
  {
    key: ORDER_ROW.PLACED,
    iconTone: 'blue',
    label: 'Оформлено',
    source: SOURCE.PROFIT,
    route: 'ym-profit',
    report: PROFIT_REPORT.PROFIT,
  },
  {
    key: ORDER_ROW.IN_TRANSIT,
    iconTone: 'violet',
    label: 'Едет к клиенту',
    source: SOURCE.IN_TRANSIT,
    route: 'ym-orders',
    report: ORDER_REPORT.IN_TRANSIT,
  },
  {
    key: ORDER_ROW.REDEEMED,
    iconTone: 'ok',
    label: 'Выкуплено',
    source: SOURCE.REDEEMED,
    route: 'ym-orders',
    report: ORDER_REPORT.REDEEMED,
  },
  {
    key: ORDER_ROW.RETURNING,
    iconTone: 'amber',
    label: 'Едет обратно',
    source: SOURCE.RETURNING,
    route: 'ym-orders',
    report: ORDER_REPORT.RETURNING,
  },
  {
    key: ORDER_ROW.CANCELLED,
    iconTone: 'danger',
    label: 'Отменено',
    source: SOURCE.PROFIT,
    route: 'ym-profit',
    report: PROFIT_REPORT.PROFIT,
  },
];

/** Модель строки: число, сумма («на 1 234 ₽»; null — суммы нет, печатается «—»). */
export interface OrderRowSummary {
  count: string;
  amount: string | null;
  /** Период или момент среза — как у карточки. */
  heading: string | null;
}

/** Дата последней загрузки прайса (ISO) — из /profile, отдельного адреса нет. */
export interface PriceListInfo {
  updatedAt: string | null;
}

/**
 * Площадки, которых ещё нет: каркас под мультимаркетплейс (решение
 * crm_dashboard_markethub). Показаны неактивными — чтобы место под них было
 * видно, но в пустой экран они не ведут.
 */
export const UPCOMING_MARKETPLACES = [
  { key: 'ozon', label: 'Ozon' },
  { key: 'wb', label: 'Wildberries' },
] as const;

/** Строка блока «Заказы», готовая к показу: мета, модель и состояние источника. */
export interface OrderRowView {
  key: OrderRowKey;
  label: string;
  icon: Component;
  iconTone: IconTone;
  to: RouteLocationRaw;
  summary: OrderRowSummary | null;
  isRefreshing: boolean;
  error: string | null;
  loadingText: string;
}

// Тона и «блеск» главной — отдельным файлом (размер домена).
export * from './dashboard-tones.domain';
// Товары, остатки и unit-экономика — отдельным файлом (размер домена), имена те же.
export * from './dashboard-products.domain';
