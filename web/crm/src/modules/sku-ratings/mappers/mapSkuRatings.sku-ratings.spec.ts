import type { RatingSku } from '../sku-ratings.domain';

import { describe, expect, it } from 'vitest';

import {
  classRow,
  demandOf,
  filterClassified,
  summaryRows,
  thresholdLines,
  topRow,
} from './mapSkuRatings.sku-ratings';

const sku = (over: Partial<RatingSku> = {}): RatingSku => ({
  sku: 'A1',
  name: 'Casio GA-2100',
  brand: 'casio',
  revenueKopecks: 1_000_000,
  netKopecks: 250_000,
  units: 5,
  costKnown: true,
  margin: 0.25,
  previousUnits: 3,
  unitsDelta: 2,
  abcRevenue: 'A',
  abcProfit: 'B',
  abcProfitReason: null,
  xyz: 'X',
  cv: 0.083,
  weeklyUnits: [1, 1, 2, 1],
  ...over,
});

describe('пороги словами', () => {
  it('ширины классов ABC и границы XYZ — из ответа сервера', () => {
    const lines = thresholdLines({
      topSize: 20,
      abc: { a: 0.8, b: 0.95 },
      xyz: { x: 0.1, y: 0.25 },
      weekDays: 7,
      minWeeks: 4,
    });
    expect(lines.abc).toEqual([
      'A — товары, которые дают первые 80 %',
      'B — следующие 15 %',
      'C — остальные 5 %',
    ]);
    expect(lines.xyz[1]).toBe('Y — от 10 до 25 %');
    expect(lines.rules[0]).toBe('В каждом рейтинге — первые 20 товаров.');
  });
});

describe('строки', () => {
  it('ТОП: место, рентабельность, спрос с тоном', () => {
    const row = topRow(sku(), 2);
    expect(row).toMatchObject({ place: 3, title: 'Casio GA-2100', subtitle: 'A1', margin: '25 %' });
    expect(row.demand).toBe('3 → 5 шт.');
    expect(row.demandTone).toBe('ok');
  });

  it('без закупа — «нет закупа» вместо чистой и прочерк рентабельности', () => {
    const row = topRow(sku({ costKnown: false, margin: null }), 0);
    expect(row.net).toBe('нет закупа');
    expect(row.margin).toBe('—');
  });

  it('спрос: новый товар и падение до нуля', () => {
    expect(demandOf(sku({ previousUnits: null, unitsDelta: 5 }))).toEqual({
      text: 'новый, 5 шт.',
      tone: 'ok',
    });
    expect(demandOf(sku({ units: 0, previousUnits: 4, unitsDelta: -4 })).tone).toBe('danger');
  });

  it('классы: причина вместо класса прибыли, вариация в процентах; без названия — артикул', () => {
    const row = classRow(
      sku({ name: null, abcProfit: null, abcProfitReason: 'нет закупа', cv: null, xyz: null }),
    );
    expect(row).toMatchObject({
      title: 'A1',
      subtitle: null,
      abcProfitNote: 'нет закупа',
      cv: '—',
    });
    expect(classRow(sku()).cv).toBe('8,3 %');
  });

  it('сводка класса: число товаров и доля', () => {
    expect(summaryRows([{ key: 'A', skus: 12, kopecks: 1, share: 0.781 }], 'выручки')).toEqual([
      { key: 'A', count: '12 товаров', share: '78,1 % выручки' },
    ]);
  });

  it('фильтр по классам и поиск по названию и артикулу', () => {
    const rows = [sku(), sku({ sku: 'B2', name: 'Восток', abcRevenue: 'C', xyz: 'Z' })];
    expect(filterClassified(rows, { query: '', abc: 'C', xyz: 'all' }).map((r) => r.sku)).toEqual([
      'B2',
    ]);
    expect(filterClassified(rows, { query: 'casio', abc: 'all', xyz: 'all' })).toHaveLength(1);
    expect(filterClassified(rows, { query: '', abc: 'all', xyz: 'X' })).toHaveLength(1);
  });
});
