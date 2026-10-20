import type { PriceCalcRatesResponse } from '../price-calculator.domain';
import type { CalcRequest } from './mapCalc.price-calculator';

import { describe, expect, it } from 'vitest';

import {
  baseRates,
  calculate,
  filterCalcSkus,
  parseNumber,
  parseRateInput,
  rateInputValue,
  withOverrides,
  withTariff,
} from './mapCalc.price-calculator';

const data: PriceCalcRatesResponse = {
  window: { from: '2026-09-16', to: '2026-10-15' },
  account: {
    commissionRate: 0.2,
    promotionRate: 0.02,
    logisticsKopecks: 15_000,
    otherKopecks: 1_000,
  },
  tax: {
    mode: 'revenue',
    regimeLabel: 'УСН «Доходы»',
    rate: 0.06,
    minRate: 0,
    source: 'tax_default',
  },
  skus: [
    {
      sku: 'A1',
      name: 'Часы Casio',
      units: 4,
      avgPriceKopecks: 300_000,
      rates: {
        commissionRate: 0.23,
        promotionRate: 0.05,
        logisticsKopecks: 20_000,
        otherKopecks: 0,
      },
      ratesSource: 'fact_sku',
      cogsKopecks: 135_000,
      cogsSource: 'price_list',
    },
    {
      sku: 'B2',
      name: null,
      units: 1,
      avgPriceKopecks: 250_000,
      rates: null,
      ratesSource: 'no_data',
      cogsKopecks: null,
      cogsSource: 'no_data',
    },
  ],
  sourceLabels: {
    fact_sku: 'факт товара за 30 дней',
    fact_account: 'факт по всем товарам за 30 дней',
    price_list: 'закуп из прайса',
    tax_settings: 'настройки налогов',
    tax_default: 'налог по умолчанию',
    tariff: 'тариф ЯМ',
    manual: 'введено',
    no_data: 'нет данных',
  },
};

const request = (over: Partial<CalcRequest> = {}): CalcRequest => ({
  mode: 'profit',
  priceKopecks: 300_000,
  targetKind: 'percent',
  target: null,
  discountRate: 0,
  taxMode: 'revenue',
  taxMinRate: 0,
  ...over,
});

const a1 = data.skus[0] ?? null;

describe('ставки по слоям: факт → тариф → введено', () => {
  it('у каждой ставки свой источник: факт товара, закуп из прайса, налог', () => {
    const rates = baseRates(data, a1);
    expect(rates.commission).toEqual({ value: 0.23, source: 'fact_sku' });
    expect(rates.cogs).toEqual({ value: 135_000, source: 'price_list' });
    expect(rates.tax).toEqual({ value: 0.06, source: 'tax_default' });
  });

  it('без товара — средние по всем товарам, закупа нет', () => {
    const rates = baseRates(data, null);
    expect(rates.logistics).toEqual({ value: 15_000, source: 'fact_account' });
    expect(rates.cogs).toEqual({ value: null, source: 'no_data' });
  });

  it('тариф ЯМ заменяет комиссию и логистику, введённое — поверх всего', () => {
    const tariff = {
      sku: 'A1',
      priceKopecks: 300_000,
      commissionRate: 0.25,
      logisticsKopecks: 17_000,
      services: [],
    };
    const rates = withOverrides(withTariff(baseRates(data, a1), tariff), { logistics: 9_900 });
    expect(rates.commission).toEqual({ value: 0.25, source: 'tariff' });
    expect(rates.logistics).toEqual({ value: 9_900, source: 'manual' });
    expect(rates.promotion.source).toBe('fact_sku');
  });
});

describe('расчёт', () => {
  it('цена → прибыль: разложение складывается в прибыль', () => {
    const view = calculate(baseRates(data, a1), request());
    if (view.state !== 'ok') throw new Error(view.state);
    const r = view.result;
    expect(r.profitKopecks).toBe(300_000 - 69_000 - 15_000 - 20_000 - 135_000 - 18_000);
    expect(view.lines.at(-2)?.label).toBe('Прибыль');
  });

  it('прибыль → цена → прибыль: обратный расчёт и прямой сходятся', () => {
    const rates = baseRates(data, a1);
    const back = calculate(rates, request({ mode: 'price', targetKind: 'rub', target: 70_000 }));
    if (back.state !== 'ok') throw new Error(back.state);
    expect(Math.abs(back.result.profitKopecks - 70_000)).toBeLessThanOrEqual(4);
    const forward = calculate(rates, request({ priceKopecks: back.result.priceKopecks }));
    if (forward.state !== 'ok') throw new Error(forward.state);
    expect(forward.result.profitKopecks).toBe(back.result.profitKopecks);
  });

  it('рентабельность → цена', () => {
    const view = calculate(baseRates(data, a1), request({ mode: 'price', target: 0.2 }));
    if (view.state !== 'ok') throw new Error(view.state);
    expect(view.result.margin as number).toBeCloseTo(0.2, 4);
  });

  it('нет ставки — просим ввести, а не считаем с нулём', () => {
    expect(calculate(baseRates(data, data.skus[1] ?? null), request())).toEqual({
      state: 'missing',
      keys: ['commission', 'promotion', 'logistics', 'other', 'cogs'],
    });
  });

  it('недостижимая цель — причина словами', () => {
    const view = calculate(baseRates(data, a1), request({ mode: 'price', target: 0.9 }));
    expect(view.state).toBe('failure');
  });

  it('пустая цена — ждём ввода', () => {
    expect(calculate(baseRates(data, a1), request({ priceKopecks: null })).state).toBe('input');
  });
});

describe('ввод чисел', () => {
  it('запятая, пробелы, знаки ₽ и %', () => {
    expect(parseNumber('1 234,5 ₽')).toBe(1234.5);
    expect(parseNumber('12 %')).toBe(12);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });

  it('ставка: проценты → доля, рубли → копейки; отрицательное не принимается', () => {
    expect(parseRateInput('commission', '23,5')).toBeCloseTo(0.235, 12);
    expect(parseRateInput('cogs', '1350')).toBe(135_000);
    expect(parseRateInput('cogs', '-1')).toBeNull();
    expect(rateInputValue('commission', 0.235)).toBe('23,5');
    expect(rateInputValue('cogs', 135_050)).toBe('1350,5');
  });

  it('поиск товара по названию и артикулу', () => {
    expect(filterCalcSkus(data.skus, 'casio', 8).map((s) => s.sku)).toEqual(['A1']);
    expect(filterCalcSkus(data.skus, 'b2', 8).map((s) => s.sku)).toEqual(['B2']);
    expect(filterCalcSkus(data.skus, '', 8)).toEqual([]);
  });
});
