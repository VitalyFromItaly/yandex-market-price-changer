import type { ReportPeriod } from '@/shared/period';

import { ORDER_REPORT, ordersJobKind } from '@/modules/orders/orders.domain';
import { PROFIT_REPORT, profitJobKind } from '@/modules/profit/profit.domain';

/**
 * «Главная»: несколько плиток с числами из тех же фоновых задач, что страницы
 * отчётов (`orders:*`, `profit:profit`), — своего kind и своих формул у главной
 * нет. Каждая плитка грузится сама: медленная прибыль не держит остальные.
 */

export const DASHBOARD_ROUTE_NAME = 'ym-dashboard';

export const TILE = {
  IN_TRANSIT: 'in_transit',
  RETURNING: 'returning',
  SHIPPED: 'shipped_today',
  PROFIT: 'profit',
} as const;

export type TileKey = (typeof TILE)[keyof typeof TILE];

export interface TileMeta {
  key: TileKey;
  label: string;
  /** Фича, без которой плитки нет (закрытая вела бы в 403 гейта). */
  feature: string;
  /** Фоновая задача — та же, что у страницы отчёта. */
  kind: string;
  /** Куда ведёт число: маршрут раздела и вкладка (она же ключ отчёта в ответе). */
  route: string;
  report: string;
  /** Период задачи и ссылки; null — срез без периода. */
  period: ReportPeriod | null;
  /**
   * Подпись на время сборки. У каждой плитки своя: одни полоски-скелетоны
   * читаются как пустая карточка, а задача может стоять в очереди секунды.
   */
  loadingText: string;
}

/**
 * «Едет обратно» — «Всего»: без периода отчёт отдаёт возвраты в пути, то самое
 * число кабинета. «Уехало сегодня» — «Сегодня», прибыль — «С 1 числа месяца».
 */
export const TILES: readonly TileMeta[] = [
  {
    key: TILE.IN_TRANSIT,
    label: 'Едет до клиента',
    feature: 'report_in_transit',
    kind: ordersJobKind(ORDER_REPORT.IN_TRANSIT),
    route: 'ym-orders',
    report: ORDER_REPORT.IN_TRANSIT,
    period: null,
    loadingText: 'Собираю заказы в доставке…',
  },
  {
    key: TILE.RETURNING,
    label: 'Едет обратно',
    feature: 'report_returning',
    kind: ordersJobKind(ORDER_REPORT.RETURNING),
    route: 'ym-orders',
    report: ORDER_REPORT.RETURNING,
    period: { key: 'all', day: null },
    loadingText: 'Собираю возвраты в пути…',
  },
  {
    key: TILE.SHIPPED,
    label: 'Уехало сегодня',
    feature: 'report_shipped_today',
    kind: ordersJobKind(ORDER_REPORT.SHIPPED),
    route: 'ym-orders',
    report: ORDER_REPORT.SHIPPED,
    period: { key: 'today', day: null },
    loadingText: 'Собираю отгрузки за сегодня…',
  },
  {
    key: TILE.PROFIT,
    label: 'Прибыль с 1 числа',
    feature: 'report_profit',
    kind: profitJobKind(PROFIT_REPORT.PROFIT),
    route: 'ym-profit',
    report: PROFIT_REPORT.PROFIT,
    period: { key: 'month', day: null },
    loadingText: 'Считаю заказы, закуп и возвраты…',
  },
];

/** Модель плитки — готовые к показу строки; числа посчитал бэкенд. */
export interface TileSummary {
  /** Крупное число: «42» или «12 345 ₽». */
  value: string;
  /** Подпись под числом: «на 1 234 ₽», «Ожидается чистая». */
  caption: string | null;
  /** «за сегодня, 24-09-2026» / «на 24-09-2026 10:00 МСК». */
  heading: string;
  /** Нечего показывать — хороший пустой день, а не «нет данных». */
  empty: boolean;
  emptyText: string;
  /** Убыток — число красим. */
  negative: boolean;
}

/** Дата последней загрузки прайса (ISO) — из /profile, отдельного адреса нет. */
export interface PriceListInfo {
  updatedAt: string | null;
}
