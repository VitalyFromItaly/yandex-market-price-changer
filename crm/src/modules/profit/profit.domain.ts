import type { ReportPeriod } from '@/shared/period';

/**
 * «Прибыль» и «Калькулятор» — две вкладки одного раздела. Зеркало ответа
 * фоновых задач `profit:<report>` (toCrmProfitView / toCrmTariffView в
 * src/modules/crm/profit/crm-profit.domain.ts).
 *
 * Все суммы и решения (какой набор основной, чья оценка калькулятора, какие
 * sku без закупа) приходят готовыми — это тот же ProfitService, что у бота.
 * Фронт только раскладывает и форматирует.
 */

export const PROFIT_REPORT = {
  PROFIT: 'profit',
  TARIFF: 'tariff_calc',
} as const;

export type ProfitReportKey = (typeof PROFIT_REPORT)[keyof typeof PROFIT_REPORT];

export interface ProfitReportMeta {
  key: ProfitReportKey;
  /** Подпись — как кнопка бота, без эмодзи. */
  label: string;
  /** Фича, закрывающая вкладку. */
  feature: string;
}

/**
 * Обе вкладки умеют период глубже 30 дней при открытой deep_history (askDay
 * бота: REDEEMED, PROFIT, TARIFF_CALC).
 */
export const PROFIT_REPORTS: readonly ProfitReportMeta[] = [
  { key: PROFIT_REPORT.PROFIT, label: 'Прибыль', feature: 'report_profit' },
  { key: PROFIT_REPORT.TARIFF, label: 'Калькулятор', feature: 'tariff_calc' },
];

export const DEEP_HISTORY_FEATURE = 'deep_history';

export function profitJobKind(key: ProfitReportKey): string {
  return `profit:${key}`;
}

// --- ответ сервера ----------------------------------------------------------

export interface ProfitBlockResponse {
  orders: number;
  revenue: number;
  subsidies: number;
  commission: number;
  commissionPercent: number;
  tax: number;
  taxPercent: number;
  promo: number;
  purchase: number;
  net: number;
}

export interface ExcludedResponse {
  orders: number;
  revenue: number;
  skus: string[];
  reason: string;
}

export interface PurchaseBasisResponse {
  updatedAt: string | null;
  defaultPercent: number;
  overrides: { title: string; percent: number }[];
  text: string;
}

interface ReportBaseResponse {
  period: ReportPeriod;
  title: string;
  periodTitle: string;
  emptyText: string;
  empty: boolean;
  returned: { orders: number; revenue: number };
  excluded: ExcludedResponse;
  prices: PurchaseBasisResponse;
}

export interface ProfitResponse extends ReportBaseResponse {
  key: typeof PROFIT_REPORT.PROFIT;
  main: 'placed' | 'redeemed';
  placed: ProfitBlockResponse;
  redeemed: ProfitBlockResponse;
  cancelled: number;
  estimate: { servicesTotal: number; share: string | null } | null;
  promo: string[];
  notes: { placed: string; otherOrders: string; unknownSkus: string };
}

export interface TariffResponse extends ReportBaseResponse {
  key: typeof PROFIT_REPORT.TARIFF;
  totalOrders: number;
  block: ProfitBlockResponse;
  servicesShare: string | null;
  services: { type: string; label: string; sum: number }[];
  comparison: {
    commissionPercent: number;
    flat: number;
    diff: number;
    servicesHigher: boolean;
    text: string;
  };
  notes: { placed: string; approx: string; nothingCounted: string };
}

export type ProfitReportResponse = ProfitResponse | TariffResponse;

// --- модель экрана ----------------------------------------------------------

/**
 * Строка столбца вычитаний. `minus` — вычитание из продаж, `info` — справочная
 * строка, в арифметику не входит (оценка калькулятора), `total` — чистая.
 */
export interface BreakdownRow {
  label: string;
  value: number;
  kind: 'plus' | 'minus' | 'info' | 'total';
  /** Пояснение под строкой: «в т.ч. субсидии Маркета: …», «≈24%». */
  hint: string | null;
  /** Чистая в минусе — убыток. */
  negative: boolean;
}

export interface Breakdown {
  /** «Оформлено» или «Заказов» — как у бота. */
  countLabel: string;
  count: number;
  rows: BreakdownRow[];
  note: string | null;
  /**
   * Маржа — доля чистой в продажах (0.22 = 22 %). Вид, а не новая сумма: оба
   * числа приходят с сервера. `null` при нулевых продажах — делить не на что.
   */
  margin: number | null;
}

export interface ServiceRow {
  type: string;
  label: string;
  sum: number;
}

export interface Excluded {
  orders: number;
  revenue: number;
  reason: string;
  skus: string[];
  /** Что делать: «Пришлите прайс…»; null — у калькулятора причина не только в прайсе. */
  advice: string | null;
}

interface ReportBase {
  period: ReportPeriod;
  heading: string;
  empty: boolean;
  emptyText: string;
  /** Строки под сводкой: отменённые, выкуплено, сравнение, возвраты — в словах бота. */
  lines: string[];
  excluded: Excluded | null;
  footer: string[];
}

export interface ProfitReport extends ReportBase {
  key: typeof PROFIT_REPORT.PROFIT;
  breakdown: Breakdown;
}

export interface TariffReport extends ReportBase {
  key: typeof PROFIT_REPORT.TARIFF;
  /** null — заказы есть, а посчитать не удалось ни одного. */
  breakdown: Breakdown | null;
  services: ServiceRow[];
}

export type ProfitScreen = ProfitReport | TariffReport;
