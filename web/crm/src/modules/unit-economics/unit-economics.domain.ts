import type { IUnconfirmedProfit } from '../../../../../src/shared/profit-confirmation';
/**
 * «Unit-экономика» (TASK-138, ТЗ п.7) — прибыль и расходы по каждому товару за
 * период, раздел уровня аккаунта.
 *
 * Числа — разрез того же P&L, что «Финансы» (`unit-economics:skus` поверх
 * `FinanceService.build`): сумма по товарам вместе со строкой «не относится к
 * товару» равна чистой прибыли «Финансов» за тот же период. Площадка — из
 * адреса (TASK-181): журнал и артикулы своей площадки; на ЯМ Ozon и Wildberries
 * в карточке подписаны «скоро», без нулей (решение `ozon_wb_skipped_for_now`).
 */
import type { MarketplaceKey } from '@/navigation.sections';
import type { DayRange } from '@/shared/utils';

export const UNIT_ECONOMICS_KIND = 'unit-economics:skus';
/** Без «Финансов» прибыли по товару нет: задача получила бы 403 гейта. */
export const FINANCE_FEATURE = 'finance';
/** Раздел «Калькулятор цен» (TASK-139): из карточки товара — ссылка с этим товаром. */
export const PRICE_CALCULATOR_ROUTE = 'ym-price-calculator';

// --- ответ задачи ------------------------------------------------------------

export type SkuColumn =
  | 'revenue'
  | 'otherIncome'
  | 'commission'
  | 'logistics'
  | 'promotion'
  | 'otherServices'
  | 'unrecognized';

export type SkuColumns = Record<SkuColumn, number>;

export type UnitShareKey =
  | 'commission'
  | 'logistics'
  | 'promotion'
  | 'otherServices'
  | 'cogs'
  | 'tax';

export interface UnitScheme {
  scheme: string | null;
  units: number;
  revenueKopecks: number;
  netKopecks: number;
}

export interface UnitPrevious {
  revenueKopecks: number;
  netKopecks: number;
  units: number;
  margin: number | null;
}

export interface UnitSku {
  sku: string;
  name: string | null;
  scheme: string | null;
  units: number;
  orders: number;
  costKnown: boolean;
  columns: SkuColumns;
  cogsKopecks: number;
  taxKopecks: number;
  netKopecks: number;
  avgPriceKopecks: number | null;
  unitCostKopecks: number | null;
  unitNetKopecks: number | null;
  margin: number | null;
  shares: Record<UnitShareKey, number | null>;
  minPriceKopecks: number | null;
  previous: UnitPrevious | null;
  schemes: UnitScheme[];
}

export interface UnitRest {
  columns: SkuColumns;
  taxKopecks: number;
  operatingKopecks: number;
  netKopecks: number;
  lines: number;
}

export interface UnitEconomicsResponse {
  /** Площадка журнала (TASK-181) — эхо запроса; старый ответ без неё — ЯМ. */
  marketplace?: MarketplaceKey;
  period: DayRange;
  previousPeriod: DayRange;
  status: 'preliminary' | 'final' | 'verified' | 'discrepancy';
  statusLabel: string;
  netKopecks: number;
  revenueKopecks: number;
  /** Признак движка: продажи без закупа — прибыль не подтверждена. */
  unconfirmed: IUnconfirmedProfit;
  skus: UnitSku[];
  rest: UnitRest;
}

export interface UnitRequest {
  range: DayRange;
  previous: DayRange;
}

// --- вид -----------------------------------------------------------------------

/** Сортировка таблицы: по выручке (умолчание), по прибыли, по рентабельности. */
export type UnitSort = 'revenue' | 'net' | 'margin';

export const UNIT_SORT_OPTIONS: { value: UnitSort; label: string }[] = [
  { value: 'revenue', label: 'По выручке' },
  { value: 'net', label: 'По прибыли' },
  { value: 'margin', label: 'По рентабельности' },
];

export type Tone = 'ok' | 'danger' | 'muted';

export interface UnitRow {
  sku: string;
  title: string;
  /** Артикул под названием; null — название и есть артикул. */
  subtitle: string | null;
  scheme: string | null;
  units: string;
  revenue: string;
  net: string;
  netTone: Tone;
  margin: string;
  unitNet: string;
  /** «+1 200 ₽» к прошлому периоду; null — товар в прошлом не продавался. */
  delta: string | null;
  deltaTone: Tone;
  costKnown: boolean;
}

/** Строка таблицы карточки: показатель × площадки. */
export interface UnitCardLine {
  label: string;
  /** Значение по Маркету. */
  ym: string;
  hint?: string;
  tone?: Tone;
  /** Итоговая строка — жирным. */
  strong?: boolean;
}

/** Площадки карточки: Маркет — числа, остальные — «скоро». */
export const UNIT_PLATFORMS = [
  { key: 'ym', label: 'Яндекс Маркет', ready: true },
  { key: 'ozon', label: 'Ozon', ready: false },
  { key: 'wb', label: 'Wildberries', ready: false },
] as const;

export const NO_COST_NOTE =
  'Закупа на дату продажи нет — себестоимость и прибыль не подтверждены. Загрузите прайс с этим товаром.';

export const REST_NOTE =
  'Не относится к товару: подписка, хранение, услуги без заказа, операционные расходы бизнеса и ' +
  'их доля налога. С ней сумма по товарам равна чистой прибыли «Финансов».';

export const MIN_PRICE_HINT =
  'Цена штуки, при которой прибыль = 0: комиссия, продвижение и налог — процентом от цены, ' +
  'закуп и логистика — на штуку, как в этом периоде.';
