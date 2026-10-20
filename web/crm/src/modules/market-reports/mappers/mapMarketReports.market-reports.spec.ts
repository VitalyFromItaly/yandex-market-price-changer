import type { MarketReportForm, MarketReportsOptions } from '../market-reports.domain';

import { describe, expect, it } from 'vitest';

import {
  defaultForm,
  mapMarketCategories,
  mapMarketReportsOptions,
  marketParams,
  paramsCaption,
  sameParams,
} from './mapMarketReports.market-reports';

const OPTIONS: MarketReportsOptions = mapMarketReportsOptions({
  reports: [{ key: 'comp', title: 'Конкурентная позиция', hourlyLimit: 10 }],
  periods: [
    { key: 'week', label: 'Последние 7 дней' },
    { key: 'prevmonth', label: 'Прошлый месяц' },
  ],
  months: [{ year: 2026, month: 7, label: 'Июль 2026' }],
  groupings: [{ key: 'CATEGORIES', label: 'По категориям' }],
  detalizations: [{ key: 'WEEK', label: 'По неделям' }],
});

const FORM: MarketReportForm = {
  period: 'prevmonth',
  month: '2026-07',
  categoryId: 91491,
  grouping: 'OFFERS',
  detalization: 'MONTH',
};

describe('mapMarketReports', () => {
  it('опции: отчёты с квотой, месяц — «ГГГГ-ММ»', () => {
    expect(OPTIONS.reports).toEqual([
      { key: 'comp', label: 'Конкурентная позиция', hourlyLimit: 10 },
    ]);
    expect(OPTIONS.months).toEqual([{ value: '2026-07', label: 'Июль 2026' }]);
  });

  it('по умолчанию — первые варианты, категорию продавец выбирает сам', () => {
    expect(defaultForm(OPTIONS)).toEqual({
      period: 'week',
      month: '2026-07',
      categoryId: null,
      grouping: 'CATEGORIES',
      detalization: 'WEEK',
    });
  });

  it('params — ровно в форме эха сервера, по типу отчёта', () => {
    expect(marketParams('real', FORM)).toEqual({ year: 2026, month: 7 });
    expect(marketParams('turn', FORM)).toEqual({});
    expect(marketParams('comp', FORM)).toEqual({ categoryId: 91491, periodKey: 'prevmonth' });
    expect(marketParams('shows', FORM)).toEqual({ periodKey: 'prevmonth', grouping: 'OFFERS' });
    expect(marketParams('key', FORM)).toEqual({ detalizationLevel: 'MONTH' });
    expect(marketParams('geo', FORM)).toEqual({ periodKey: 'prevmonth' });
  });

  it('незаполненная форма — null, «Сформировать» неактивна', () => {
    expect(marketParams('comp', { ...FORM, categoryId: null })).toBeNull();
    expect(marketParams('real', { ...FORM, month: null })).toBeNull();
  });

  it('эхо сравнивается без учёта порядка ключей', () => {
    expect(sameParams({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toBe(true);
    expect(sameParams({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameParams({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('пустой каталог — текст сервера вместо пустых кнопок', () => {
    expect(mapMarketCategories({ categories: [], emptyText: 'Не удалось.' })).toEqual({
      options: [],
      emptyText: 'Не удалось.',
    });
  });

  it('подпись «что собрано» — из подписей вариантов', () => {
    const categories = mapMarketCategories({
      categories: [{ categoryId: 91491, name: 'Наручные часы', offers: 10 }],
      emptyText: null,
    });
    expect(paramsCaption({ categoryId: 91491, periodKey: 'prevmonth' }, OPTIONS, categories)).toBe(
      'Наручные часы · Прошлый месяц',
    );
    expect(paramsCaption({ year: 2026, month: 7 }, OPTIONS, null)).toBe('Июль 2026');
    expect(paramsCaption({}, OPTIONS, null)).toBeNull();
  });
});
