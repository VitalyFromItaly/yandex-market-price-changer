/**
 * Состояние прибыли заказа «Финучёта» (TASK-218, ТЗ п.5) — надстройка над
 * `orderResultOf`: правила карточки не меняются, здесь только решается,
 * окончательная ли перед продавцом прибыль, и дописывается прогноз недостающего.
 *
 * Состояния:
 * - `forecast` — по заказу ещё нет ни одной операции реестра: всё из строк заказа
 *   и прогноза;
 * - `preliminary` — операции есть, но месяц не сверен (или сверка нашла
 *   расхождение), либо в карточке осталось ожидаемое / неизвестное;
 * - `reconciled` — месяц сверен (`orderReconcileStateOf` → `reconciled`) и все
 *   суммы карточки фактические или распределённые по методике.
 *
 * Прогноз — средние ставки «Калькулятора цен» за 30 дней (`PriceCalcRatesService`):
 * это факт P&L окна, не тарифы площадки, поэтому сумма всегда `expected` с
 * причиной `forecast` и подписью основания. Прогнозом заполняются только
 * обязательные строки, которых в карточке нет совсем (`unknown` / `no-operations`):
 * комиссия и логистика. Фактическое и ожидаемое из полей заказа не переписываются.
 *
 * «Подтверждённое» = Σ actual + allocated; ожидаемое — отдельно и туда не
 * входит никогда (решение `accounting_order_profit_state`).
 */

import type { IAccountingOrderLineInput } from './accounting-order-lines.domain';
import type { TOrderReconcileState } from './accounting-reconcile.domain';
import type {
  IOrderResult,
  IOrderResultAmount,
  TOrderResultKey,
  TOrderResultReason,
} from './order-result';
import type { ICalcSku } from '../finance/price-calc-rates';

import { createHash } from 'crypto';

import { profitAt } from '../../shared/price-calc';

import { ORDER_RESULT_REQUIRED_KEYS, isGoneOrderLine } from './order-result';

export type TOrderProfitState = 'forecast' | 'preliminary' | 'reconciled';

/** Подпись состояния — один текст для CRM и бота. */
export const ORDER_PROFIT_STATE_TITLE: Record<TOrderProfitState, string> = {
  forecast: 'Прогноз',
  preliminary: 'Предварительно',
  reconciled: 'Сверено',
};

/** Пояснение рядом с суммой: неокончательная прибыль не выглядит окончательной. */
export const ORDER_PROFIT_STATE_HINT: Record<TOrderProfitState, string> = {
  forecast: 'Начислений по заказу ещё нет — оценка, не окончательная прибыль',
  preliminary: 'Часть сумм ещё ожидается или месяц не сверен — прибыль не окончательная',
  reconciled: 'Месяц сверен с документами площадки — прибыль окончательная',
};

/** Основание прогноза по умолчанию. */
export const ORDER_FORECAST_BASIS = 'Оценка по средним ставкам за 30 дней';

/** Ставки прогноза одной строки заказа. */
export interface IOrderForecastRates {
  /** Комиссия с эквайрингом, доля выручки. */
  commissionRate: number;
  /** Логистика на штуку, копейки. */
  logisticsKopecks: number;
  /** Откуда ставки — показывается рядом с суммой. */
  basis: string;
}

/** Ставки прогноза строки; null — для товара ставок нет. */
export type TOrderForecastOf = (line: IAccountingOrderLineInput) => IOrderForecastRates | null;

export type TOrderProfitReason = TOrderResultReason | 'forecast';

export interface IOrderProfitAmount extends Omit<IOrderResultAmount, 'reason'> {
  reason?: TOrderProfitReason;
  /** Основание прогноза — только у `reason: 'forecast'`. */
  basis?: string;
}

export interface IOrderProfit {
  state: TOrderProfitState;
  /** Окончательная — только `reconciled`. */
  final: boolean;
  /** Состояние сверки месяца заказа; null — месяц не сверялся. */
  reconcile: TOrderReconcileState | null;
  amounts: IOrderProfitAmount[];
  /** Σ фактических и распределённых по методике. */
  confirmedKopecks: number;
  /** Σ ожидаемых (из полей заказа и прогноза) — отдельно от подтверждённого. */
  expectedKopecks: number;
  /** Подтверждённое + ожидаемое; null — обязательная строка неизвестна. */
  netKopecks: number | null;
  unknown: { key: TOrderResultKey; reason: TOrderProfitReason | null } | null;
}

export interface IOrderProfitInput {
  result: IOrderResult;
  lines: readonly IAccountingOrderLineInput[];
  /** `orderReconcileStateOf` месяца заказа; null — месяц не сверялся. */
  reconcile: TOrderReconcileState | null;
  forecastOf?: TOrderForecastOf;
}

/** Ставки прогноза из строки «Калькулятора цен» (`PriceCalcRatesService.forSku`). */
export function orderForecastRatesOf(
  sku: Pick<ICalcSku, 'rates'>,
  basis: string = ORDER_FORECAST_BASIS,
): IOrderForecastRates | null {
  if (!sku.rates) return null;
  return {
    commissionRate: sku.rates.commissionRate,
    logisticsKopecks: sku.rates.logisticsKopecks,
    basis,
  };
}

const FORECAST_KEYS: ReadonlySet<TOrderResultKey> = new Set(['commission', 'delivery']);

/**
 * Прогноз строки карточки: та же формула, что у «Калькулятора цен» (`profitAt`),
 * по каждой живой позиции. Нет ставок или выручки у какой-то позиции — null.
 */
function forecastAmount(
  key: TOrderResultKey,
  lines: readonly IAccountingOrderLineInput[],
  forecastOf: TOrderForecastOf,
): IOrderProfitAmount | null {
  const live = lines.filter((l) => !isGoneOrderLine(l));
  if (!live.length) return null;
  let total = 0;
  let basis: string | null = null;
  for (const line of live) {
    const rates = forecastOf(line);
    if (!rates || line.revenueKopecks === null) return null;
    const calc = profitAt(line.revenueKopecks, {
      discountRate: 0,
      commissionRate: rates.commissionRate,
      promotionRate: 0,
      cogsKopecks: 0,
      logisticsKopecks: rates.logisticsKopecks * line.count,
      otherKopecks: 0,
      tax: { mode: 'revenue', rate: 0, minRate: 0 },
    });
    total -= key === 'commission' ? calc.commissionKopecks : calc.logisticsKopecks;
    basis ??= rates.basis;
  }
  return {
    key,
    title: '',
    kopecks: total,
    source: 'expected',
    operationIds: [],
    reason: 'forecast',
    basis: basis ?? ORDER_FORECAST_BASIS,
  };
}

/** Состояние прибыли заказа и разделение подтверждённого и ожидаемого. */
export function orderProfitStateOf(input: IOrderProfitInput): IOrderProfit {
  const { result, lines, reconcile, forecastOf } = input;

  const amounts: IOrderProfitAmount[] = result.amounts.map((amount) => {
    const missing =
      amount.source === 'unknown' &&
      amount.reason === 'no-operations' &&
      FORECAST_KEYS.has(amount.key);
    const forecast = missing && forecastOf ? forecastAmount(amount.key, lines, forecastOf) : null;
    return forecast ? { ...forecast, title: amount.title } : { ...amount };
  });

  let confirmedKopecks = 0;
  let expectedKopecks = 0;
  for (const amount of amounts) {
    if (amount.kopecks === null) continue;
    if (amount.source === 'expected') expectedKopecks += amount.kopecks;
    else if (amount.source === 'actual' || amount.source === 'allocated') {
      confirmedKopecks += amount.kopecks;
    }
  }

  const missing = amounts.find((a) => a.kopecks === null && ORDER_RESULT_REQUIRED_KEYS.has(a.key));
  const hasOperations = amounts.some((a) => a.operationIds.length > 0);
  const allFact = amounts.every((a) => a.source === 'actual' || a.source === 'allocated');

  let state: TOrderProfitState;
  if (!hasOperations) state = 'forecast';
  else if (reconcile === 'reconciled' && allFact) state = 'reconciled';
  else state = 'preliminary';

  return {
    state,
    final: state === 'reconciled',
    reconcile,
    amounts,
    confirmedKopecks,
    expectedKopecks,
    netKopecks: missing ? null : confirmedKopecks + expectedKopecks,
    unknown: missing ? { key: missing.key, reason: missing.reason ?? null } : null,
  };
}

/** Почему записана версия снимка. */
export type TOrderResultSnapshotReason = 'first' | 'recalculated' | 'reconciled' | 'correction';

export const ORDER_RESULT_SNAPSHOT_REASON_TITLE: Record<TOrderResultSnapshotReason, string> = {
  first: 'Первый расчёт',
  recalculated: 'Пересчёт: пришли начисления или изменился заказ',
  reconciled: 'Месяц сверен',
  correction: 'Корректировка после сверки',
};

/**
 * Причина новой версии (вызывается только когда отпечаток сменился): прежней нет —
 * первый расчёт; была сверенной и изменилась — поздняя корректировка; стала
 * сверенной — сверка; иначе — пересчёт.
 */
export function snapshotReasonOf(
  previous: TOrderProfitState | null,
  next: TOrderProfitState,
): TOrderResultSnapshotReason {
  if (previous === null) return 'first';
  if (previous === 'reconciled') return 'correction';
  if (next === 'reconciled') return 'reconciled';
  return 'recalculated';
}

/**
 * Отпечаток значимого в снимке: состояние, сверка, суммы с источником и
 * операциями, итог. Совпал — новая версия не пишется.
 */
export function orderProfitFingerprint(profit: IOrderProfit): string {
  const value = {
    state: profit.state,
    reconcile: profit.reconcile,
    net: profit.netKopecks,
    confirmed: profit.confirmedKopecks,
    expected: profit.expectedKopecks,
    amounts: profit.amounts.map((a) => [
      a.key,
      a.kopecks,
      a.source,
      [...a.operationIds].sort(),
      a.reason ?? null,
      a.method ?? null,
    ]),
  };
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}
