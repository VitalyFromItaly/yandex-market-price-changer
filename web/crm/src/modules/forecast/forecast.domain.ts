import type { IUnconfirmedProfit } from '../../../../../src/shared/profit-confirmation';
import type { MarketplaceKey } from '@/navigation.sections';
/**
 * «Прогнозы» (TASK-151, ТЗ п.13) — выручка, чистая, налог, возвраты и
 * поступления до конца месяца, продажи до конца года, рентабельность по
 * месяцам и необходимые закупки. Раздел уровня аккаунта.
 *
 * Метод один и детерминированный: факт с 1 числа по вчера + средний день за
 * последние N дней × оставшиеся дни. Числа — с сервера (`forecast:summary`,
 * та же дверь, что у ИИ-инструмента), экран их только форматирует; метод
 * печатается строкой из ответа. What-if по комиссии считается здесь — это
 * подстановка в уже готовый прогноз.
 */
import type { DayRange } from '@/shared/utils';

export const FORECAST_KIND = 'forecast:summary';
export const FORECAST_PURCHASES_KIND = 'forecast:purchases';
/** Без «Финансов» прогноза нет: задача получила бы 403 гейта. */
export const FINANCE_FEATURE = 'finance';
export const PRICE_CALCULATOR_ROUTE = 'ym-price-calculator';

export const BASIS_DAYS = [14, 28, 56] as const;
export type BasisDays = (typeof BASIS_DAYS)[number];
export const DEFAULT_BASIS_DAYS: BasisDays = 28;
export const BASIS_OPTIONS = BASIS_DAYS.map((days) => ({
  value: String(days),
  label: `${days} дней`,
}));

export const DEFAULT_COVER_DAYS = 30;
export const MIN_COVER_DAYS = 7;
export const MAX_COVER_DAYS = 120;
/** What-if: шаг и пределы поправки комиссии, п.п. */
export const WHAT_IF_LIMIT_PP = 30;

// --- ответ задачи ------------------------------------------------------------

export interface ForecastMetrics {
  revenueKopecks: number;
  netKopecks: number;
  units: number;
  orders: number;
  returnsKopecks: number;
  taxKopecks: number;
  payableKopecks: number;
}

export type TaxRegime = 'usn_income' | 'usn_income_minus_expenses' | 'osno' | 'npd';

export interface ForecastMarginPoint {
  month: string;
  kind: 'fact' | 'forecast';
  netMargin: number | null;
  revenueKopecks: number | null;
  netKopecks: number | null;
}

export interface Forecast {
  kind: 'forecast';
  today: string;
  method: { basisDays: BasisDays; basis: DayRange; text: string };
  daily: ForecastMetrics;
  month: {
    period: DayRange;
    factTo: string | null;
    remainingDays: number;
    fact: ForecastMetrics;
    forecast: ForecastMetrics;
    netMargin: number | null;
  };
  year: { year: number; remainingDays: number; fact: ForecastMetrics; forecast: ForecastMetrics };
  taxShare: number | null;
  returnsShare: number | null;
  inflow: {
    asOf: string;
    receivableKopecks: number;
    accrualsKopecks: number;
    totalKopecks: number;
  };
  margins: ForecastMarginPoint[];
  unconfirmed: IUnconfirmedProfit;
  taxIsDefault: boolean;
  tax: { regime: TaxRegime; rateBasisPoints: number };
}

export interface ForecastResponse {
  /** Эхо площадки (TASK-183); в ответах до неё его нет — это ЯМ. */
  marketplace?: MarketplaceKey;
  basisDays: BasisDays;
  today: string;
  forecast: Forecast | null;
  reason: string | null;
}

export interface PurchaseRow {
  sku: string;
  name: string | null;
  unitsPerDay: number;
  stock: number | null;
  daysLeft: number | null;
  needUnits: number;
  unitCostKopecks: number | null;
  needKopecks: number | null;
}

export interface PurchasesResponse {
  marketplace?: MarketplaceKey;
  today: string;
  takenAt: string;
  coverDays: number;
  basisDays: number;
  rows: PurchaseRow[] | null;
  reason: string | null;
  totalUnits: number;
  totalKopecks: number;
  withoutCost: { skus: number; units: number };
  stores: number;
  problems: { storeName: string; problem: string }[];
}

export interface PurchasesRequest {
  basisDays: BasisDays;
  coverDays: number;
}

// --- вид экрана ---------------------------------------------------------------

export type Tone = 'ok' | 'danger' | 'muted';

export interface ForecastCard {
  key: string;
  title: string;
  /** Прогноз — крупно. */
  value: string;
  /** «факт 1 234 ₽ по 16.10 · +N ₽ за 15 дн.» */
  caption: string;
  tone: Tone;
}

export interface WhatIfView {
  deltaPp: number;
  /** Δ комиссии на оставшиеся дни, копейки (>0 — дороже). */
  commissionKopecks: number;
  /** Δ налога, копейки (<0 — налог меньше). */
  taxKopecks: number;
  netKopecks: number;
  netBefore: string;
  netAfter: string;
  note: string;
}

export interface MarginBar {
  month: string;
  label: string;
  value: string;
  /** 0…1 — ширина полосы от максимального модуля. */
  width: number;
  tone: Tone;
  forecast: boolean;
}

export interface PurchaseView {
  sku: string;
  name: string;
  speed: string;
  stock: string;
  daysLeft: string;
  need: string;
  needSum: string;
  urgent: boolean;
}

export const FORECAST_NOTE =
  'Прогноз — оценка по прошлым дням, а не данные Маркета: сезонность, акции и рост не учтены.';
export const NO_COST_NOTE = 'У части проданного в окне нет закупа — прогноз чистой завышен.';
export const DEFAULT_TAX_NOTE =
  'Налоговые настройки по умолчанию (УСН «Доходы» 6 %) — подтвердите их в «Налогах».';
