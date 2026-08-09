import { describe, it, expect } from 'vitest';

import type { IPriceRecommendation } from '../../src/modules/yandex/recommendations/recommendations.domain';

import {
  parseOfferRecommendation,
  recommendationDelta,
  sortByDeltaDesc,
} from '../../src/modules/yandex/recommendations/recommendations.domain';
import { buildRecommendationsWorkbook } from '../../src/modules/yandex/recommendations/recommendations-workbook';
import { recommendationsText } from '../../src/modules/yandex/recommendations/recommendations-message';

describe('Рекомендации: разбор ответа', () => {
  it('цена — из offer, пороги — из recommendation', () => {
    const row = parseOfferRecommendation({
      offer: { offerId: 'SKU-1', price: { value: 5000 }, competitiveness: 'AVERAGE', shows: 120 },
      recommendation: {
        offerId: 'SKU-1',
        competitivenessThresholds: { optimalPrice: { value: 4500 }, averagePrice: { value: 5200 } },
      },
    });

    expect(row).toMatchObject({
      offerId: 'SKU-1',
      price: 5000,
      optimalPrice: 4500,
      averagePrice: 5200,
      competitiveness: 'AVERAGE',
      shows: 120,
    });
  });

  it('без артикула запись отбрасывается', () => {
    expect(parseOfferRecommendation({})).toBeNull();
  });
});

describe('Рекомендации: дельта', () => {
  it('считается от порога привлекательной цены', () => {
    const delta = recommendationDelta({
      offerId: 'X',
      price: 5000,
      optimalPrice: 4000,
      competitiveness: 'AVERAGE',
    });
    expect(delta).toEqual({ abs: 1000, percent: 25 });
  });

  it('нет цены или порога — null, не ноль', () => {
    // Молчаливый ноль означал бы «цена уже привлекательная» — довод orderPurchase.
    expect(
      recommendationDelta({ offerId: 'X', optimalPrice: 4000, competitiveness: 'LOW' }),
    ).toBeNull();
    expect(recommendationDelta({ offerId: 'X', price: 5000, competitiveness: 'LOW' })).toBeNull();
  });

  it('сортировка: худшие сверху, без данных — в конец', () => {
    const rows: IPriceRecommendation[] = [
      { offerId: 'small', price: 1100, optimalPrice: 1000, competitiveness: 'AVERAGE' },
      { offerId: 'nodata', competitiveness: 'LOW' },
      { offerId: 'big', price: 9000, optimalPrice: 4000, competitiveness: 'LOW' },
    ];
    expect(sortByDeltaDesc(rows).map((r) => r.offerId)).toEqual(['big', 'small', 'nodata']);
  });
});

describe('Рекомендации: экран и файл', () => {
  const rows: IPriceRecommendation[] = [
    { offerId: 'A', price: 5000, optimalPrice: 4000, competitiveness: 'AVERAGE', shows: 10 },
    { offerId: 'B', competitiveness: 'LOW' },
  ];

  it('текст несёт счётчики, момент среза и топ', () => {
    const text = recommendationsText(rows, new Date('2026-08-15T09:12:00Z'));
    expect(text).toContain('15-08-2026 12:12');
    expect(text).toContain('умеренная цена: 1');
    expect(text).toContain('непривлекательная: 1');
    expect(text).toContain('A');
  });

  it('в файл попадают все строки, включая раздел без данных', () => {
    const workbook = buildRecommendationsWorkbook(rows);
    expect(workbook.rows).toBe(2);
    expect(workbook.truncated).toBe(0);
    expect(workbook.buffer.length).toBeGreaterThan(0);
  });
});
