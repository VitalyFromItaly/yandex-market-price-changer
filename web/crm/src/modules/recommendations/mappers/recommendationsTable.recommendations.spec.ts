import type { RecommendationRow } from '../recommendations.domain';

import { describe, expect, it } from 'vitest';

import { filterRows, nextSort, sortRows } from './recommendationsTable.recommendations';

const row = (
  offerId: string,
  competitiveness: string,
  deltaAbs: number | null,
  shows: number | null = null,
): RecommendationRow => ({
  id: offerId,
  offerId,
  price: deltaAbs === null ? null : 1000 + deltaAbs,
  optimalPrice: deltaAbs === null ? null : 1000,
  averagePrice: null,
  competitiveness,
  competitivenessLabel: competitiveness,
  shows,
  deltaAbs,
  deltaPercent: deltaAbs === null ? null : deltaAbs / 10,
});

const ROWS = [
  row('Casio-1', 'AVERAGE', 100, 5),
  row('casio-2', 'LOW', null),
  row('Orient', 'LOW', 300, 1),
];

describe('таблица рекомендаций', () => {
  it('поиск по артикулу без регистра и фильтр по оценке', () => {
    expect(filterRows(ROWS, 'CASIO', 'all').map((r) => r.offerId)).toEqual(['Casio-1', 'casio-2']);
    expect(filterRows(ROWS, '', 'LOW').map((r) => r.offerId)).toEqual(['casio-2', 'Orient']);
    expect(filterRows(ROWS, 'casio', 'AVERAGE').map((r) => r.offerId)).toEqual(['Casio-1']);
  });

  it('строки без порога — в конце в обе стороны', () => {
    expect(sortRows(ROWS, 'deltaAbs', 'desc').map((r) => r.offerId)).toEqual([
      'Orient',
      'Casio-1',
      'casio-2',
    ]);
    expect(sortRows(ROWS, 'deltaAbs', 'asc').map((r) => r.offerId)).toEqual([
      'Casio-1',
      'Orient',
      'casio-2',
    ]);
  });

  it('клик по активной колонке меняет направление, новая числовая — по убыванию', () => {
    expect(nextSort({ key: 'deltaAbs', dir: 'desc' }, 'deltaAbs')).toEqual({
      key: 'deltaAbs',
      dir: 'asc',
    });
    expect(nextSort({ key: 'deltaAbs', dir: 'desc' }, 'shows')).toEqual({
      key: 'shows',
      dir: 'desc',
    });
    expect(nextSort({ key: 'deltaAbs', dir: 'desc' }, 'offerId')).toEqual({
      key: 'offerId',
      dir: 'asc',
    });
  });
});
