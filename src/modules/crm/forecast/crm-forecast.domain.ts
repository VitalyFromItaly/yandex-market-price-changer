import type { IForecast, TForecastBasisDays, TForecastResult } from '../../finance/forecast';
import type { IPurchaseNeedRow, IPurchaseNeeds } from '../../finance/forecast-purchases';

import { DEFAULT_FORECAST_BASIS_DAYS, isForecastBasisDays } from '../../finance/forecast';
import { DEFAULT_COVER_DAYS, isCoverDays } from '../../finance/forecast-purchases';

/**
 * «Прогнозы» CRM (TASK-151, ТЗ п.13) — доставка, уровня аккаунта.
 *
 * Числа считает `FinanceForecastService` (finance) — та же дверь, что у
 * ИИ-инструмента `getForecast`, поэтому экран и чат не расходятся. Здесь —
 * разбор параметров и перечисление полей ответа.
 */

export const FORECAST_KIND = 'forecast:summary';
export const FORECAST_PURCHASES_KIND = 'forecast:purchases';

export const FORECAST_PARAMS_INVALID_TEXT =
  'Параметры прогноза не распознаны: база — 14, 28 или 56 дней, запас — от 7 до 120 дней';

/** Число из params: браузер присылает число, ссылка — строку. */
const numberOf = (value: unknown) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

/** База прогноза; нет параметра — умолчание, мусор — null. */
export function parseBasisDays(params: Record<string, unknown>): TForecastBasisDays | null {
  const raw = params?.basisDays;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_FORECAST_BASIS_DAYS;
  const value = numberOf(raw);
  return isForecastBasisDays(value) ? value : null;
}

export function parseCoverDays(params: Record<string, unknown>): number | null {
  const raw = params?.coverDays;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_COVER_DAYS;
  const value = numberOf(raw);
  return isCoverDays(value) ? value : null;
}

export interface ICrmForecast {
  /** Эхо параметра — фронт сверяет его с запросом (дедуп задач по kind). */
  basisDays: TForecastBasisDays;
  today: string;
  /** null — прогноза нет, причина в `reason`. */
  forecast: IForecast | null;
  reason: string | null;
}

export function toCrmForecast(
  basisDays: TForecastBasisDays,
  today: string,
  result: TForecastResult,
): ICrmForecast {
  // strictNullChecks выключен — union не сужается, поле читается через cast.
  if (result.ok) return { basisDays, today, forecast: result.forecast, reason: null };
  return { basisDays, today, forecast: null, reason: (result as { reason: string }).reason };
}

export interface ICrmPurchaseRow extends IPurchaseNeedRow {
  name: string | null;
}

export interface ICrmStoreProblem {
  storeName: string;
  problem: string;
}

export interface ICrmForecastPurchases extends Omit<IPurchaseNeeds, 'rows'> {
  today: string;
  takenAt: string;
  /** null — прогноза нет (журнал или продажи), причина в `reason`. */
  rows: ICrmPurchaseRow[] | null;
  reason: string | null;
  stores: number;
  problems: ICrmStoreProblem[];
}
