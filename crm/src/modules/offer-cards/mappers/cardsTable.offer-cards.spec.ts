import type { CardRow } from '../offer-cards.domain';

import { describe, expect, it } from 'vitest';

import { filterRows, nextSort, sortRows } from './cardsTable.offer-cards';

const row = (
  offerId: string,
  actionable: boolean,
  contentRating: number | null,
  errorsCount = 0,
): CardRow => ({
  id: offerId,
  offerId,
  status: actionable ? 'NO_CARD_ERRORS' : 'HAS_CARD_CAN_UPDATE',
  statusLabel: actionable ? 'Ошибки' : 'Можно улучшить',
  actionable,
  contentRating,
  averageContentRating: 70,
  recommendations: [],
  errorsCount,
  warningsCount: 0,
});

const ROWS = [row('A-1', false, 80), row('a-2', true, null, 3), row('B', true, 20, 1)];

describe('таблица карточек', () => {
  it('поиск по артикулу без регистра и фильтр «требуют действий»', () => {
    expect(filterRows(ROWS, 'a-', 'all').map((r) => r.offerId)).toEqual(['A-1', 'a-2']);
    expect(filterRows(ROWS, '', 'actionable').map((r) => r.offerId)).toEqual(['a-2', 'B']);
    expect(filterRows(ROWS, '', 'rest').map((r) => r.offerId)).toEqual(['A-1']);
  });

  it('без рейтинга — в конце в обе стороны', () => {
    expect(sortRows(ROWS, 'contentRating', 'asc').map((r) => r.offerId)).toEqual([
      'B',
      'A-1',
      'a-2',
    ]);
    expect(sortRows(ROWS, 'contentRating', 'desc').map((r) => r.offerId)).toEqual([
      'A-1',
      'B',
      'a-2',
    ]);
    expect(sortRows(ROWS, 'errorsCount', 'desc').map((r) => r.offerId)).toEqual([
      'a-2',
      'B',
      'A-1',
    ]);
  });

  it('счётчики по убыванию, рейтинг и статус — по возрастанию', () => {
    expect(nextSort({ key: 'contentRating', dir: 'asc' }, 'errorsCount').dir).toBe('desc');
    expect(nextSort({ key: 'errorsCount', dir: 'desc' }, 'status').dir).toBe('asc');
    expect(nextSort({ key: 'status', dir: 'asc' }, 'status').dir).toBe('desc');
  });
});
