import type { IPriceCalcInput, IPriceCalcResult } from '../../../../../../src/shared/price-calc';
import type {
  CalcLine,
  CalcMode,
  CalcRateKey,
  CalcRates,
  CalcSkuResponse,
  PriceCalcRatesResponse,
  PriceCalcTariffResponse,
  RateSource,
  TargetKind,
} from '../price-calculator.domain';
// Формула — общий с бэкендом лист (решение price_calc_shared_leaf), не копия.

import {
  PRICE_CALC_FAILURE_TEXT,
  priceFor,
  profitAt,
} from '../../../../../../src/shared/price-calc';
import { CALC_RATE_KEYS, CALC_RATE_META } from '../price-calculator.domain';

import { formatKopecks } from '@/shared/utils';

const dash = '—';

/** Доля как процент с двумя знаками: 0.2345 → «23,45 %». */
export function formatPercent(value: number | null): string {
  if (value === null) return dash;
  return `${(value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %`;
}

/** Значение ставки для поля ввода: проценты — числом процентов, рубли — рублями. */
export function rateInputValue(key: CalcRateKey, value: number | null): string {
  if (value === null) return '';
  const number = CALC_RATE_META[key].unit === 'percent' ? value * 100 : value / 100;
  return String(Math.round(number * 100) / 100).replace('.', ',');
}

export function formatRate(key: CalcRateKey, value: number | null): string {
  if (value === null) return dash;
  return CALC_RATE_META[key].unit === 'percent' ? formatPercent(value) : formatKopecks(value);
}

/** «1 234,5» / «1234.5» / «12 %» → число; пусто или мусор → null. */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[\s%₽]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Ввод ставки → значение в единицах формулы (доля или копейки). */
export function parseRateInput(key: CalcRateKey, text: string): number | null {
  const value = parseNumber(text);
  if (value === null || value < 0) return null;
  return CALC_RATE_META[key].unit === 'percent' ? value / 100 : Math.round(value * 100);
}

/**
 * Ставки товара из ответа; без товара — средние по всем товарам, закупа нет.
 * Источник у каждой ставки свой: закуп может быть из прайса при факте комиссии.
 */
export function baseRates(data: PriceCalcRatesResponse, sku: CalcSkuResponse | null): CalcRates {
  const rates = sku ? sku.rates : data.account;
  let ratesSource: RateSource = data.account ? 'fact_account' : 'no_data';
  if (sku) ratesSource = sku.ratesSource;
  const fact = (value: number | undefined) => ({
    value: rates ? (value ?? null) : null,
    source: rates ? ratesSource : ('no_data' as const),
  });
  return {
    commission: fact(rates?.commissionRate),
    promotion: fact(rates?.promotionRate),
    logistics: fact(rates?.logisticsKopecks),
    other: fact(rates?.otherKopecks),
    cogs: sku
      ? { value: sku.cogsKopecks, source: sku.cogsSource }
      : { value: null, source: 'no_data' },
    tax: { value: data.tax.rate, source: data.tax.source },
  };
}

/** Тариф Маркета заменяет комиссию и логистику — с меткой «тариф ЯМ». */
export function withTariff(rates: CalcRates, tariff: PriceCalcTariffResponse | null): CalcRates {
  if (!tariff) return rates;
  return {
    ...rates,
    commission: { value: tariff.commissionRate, source: 'tariff' },
    logistics: { value: tariff.logisticsKopecks, source: 'tariff' },
  };
}

/** Введённое руками — поверх всего, с меткой «введено». */
export function withOverrides(
  rates: CalcRates,
  overrides: Partial<Record<CalcRateKey, number>>,
): CalcRates {
  const next = { ...rates };
  for (const key of CALC_RATE_KEYS) {
    const value = overrides[key];
    if (value !== undefined) next[key] = { value, source: 'manual' };
  }
  return next;
}

export interface CalcRequest {
  mode: CalcMode;
  /** Цена для прямого расчёта, копейки. */
  priceKopecks: number | null;
  targetKind: TargetKind;
  /** Цель обратного расчёта: копейки или доля. */
  target: number | null;
  discountRate: number;
  taxMode: 'revenue' | 'profit';
  taxMinRate: number;
}

export type CalcView =
  | { state: 'missing'; keys: CalcRateKey[] }
  | { state: 'input' }
  | { state: 'failure'; text: string }
  | { state: 'ok'; result: IPriceCalcResult; lines: CalcLine[] };

function inputOf(rates: CalcRates, request: CalcRequest): IPriceCalcInput | CalcRateKey[] {
  const missing = CALC_RATE_KEYS.filter((key) => rates[key].value === null);
  if (missing.length) return missing;
  const v = (key: CalcRateKey) => rates[key].value as number;
  return {
    discountRate: request.discountRate,
    commissionRate: v('commission'),
    promotionRate: v('promotion'),
    cogsKopecks: v('cogs'),
    logisticsKopecks: v('logistics'),
    otherKopecks: v('other'),
    tax: { mode: request.taxMode, rate: v('tax'), minRate: request.taxMinRate },
  };
}

/** Разложение результата: от цены к прибыли, Σ строк = прибыли. */
export function resultLines(r: IPriceCalcResult): CalcLine[] {
  const minus = (kopecks: number) =>
    kopecks === 0 ? formatKopecks(0) : `−${formatKopecks(kopecks)}`;
  const lines: CalcLine[] = [{ label: 'Цена', value: formatKopecks(r.priceKopecks) }];
  if (r.discountKopecks) lines.push({ label: 'Скидка', value: minus(r.discountKopecks) });
  lines.push(
    { label: 'Продажа', value: formatKopecks(r.saleKopecks), strong: true },
    { label: CALC_RATE_META.commission.label, value: minus(r.commissionKopecks) },
    { label: CALC_RATE_META.promotion.label, value: minus(r.promotionKopecks) },
    { label: CALC_RATE_META.logistics.label, value: minus(r.logisticsKopecks) },
    { label: CALC_RATE_META.other.label, value: minus(r.otherKopecks) },
    { label: CALC_RATE_META.cogs.label, value: minus(r.cogsKopecks) },
    { label: CALC_RATE_META.tax.label, value: minus(r.taxKopecks) },
    { label: 'Прибыль', value: formatKopecks(r.profitKopecks), strong: true },
    { label: 'Рентабельность', value: formatPercent(r.margin) },
  );
  return lines;
}

/** Прямой или обратный расчёт по форме; причина вместо нуля, когда ответа нет. */
export function calculate(rates: CalcRates, request: CalcRequest): CalcView {
  const input = inputOf(rates, request);
  if (Array.isArray(input)) return { state: 'missing', keys: input };

  let price: number;
  if (request.mode === 'profit') {
    if (request.priceKopecks === null || request.priceKopecks <= 0) return { state: 'input' };
    price = request.priceKopecks;
  } else {
    if (request.target === null) return { state: 'input' };
    const solution = priceFor(
      request.targetKind === 'rub'
        ? { kind: 'profit', kopecks: request.target }
        : { kind: 'margin', rate: request.target },
      input,
    );
    if (!solution.ok) return { state: 'failure', text: PRICE_CALC_FAILURE_TEXT[solution.reason] };
    price = solution.priceKopecks;
  }
  const result = profitAt(price, input);
  return { state: 'ok', result, lines: resultLines(result) };
}

/** Поиск товара по названию и артикулу без регистра; первые `limit` по выручке. */
export function filterCalcSkus(
  skus: readonly CalcSkuResponse[],
  query: string,
  limit: number,
): CalcSkuResponse[] {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  if (needle === '') return [];
  return skus
    .filter(
      (sku) =>
        sku.sku.toLocaleLowerCase('ru-RU').includes(needle) ||
        (sku.name ?? '').toLocaleLowerCase('ru-RU').includes(needle),
    )
    .slice(0, limit);
}
