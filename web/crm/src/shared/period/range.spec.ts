import { describe, expect, it } from 'vitest';

import {
  isValidRange,
  previousRange,
  rangeFromQuery,
  rangeLabel,
  rangeOf,
  sameRange,
} from './range';

const TODAY = '2026-10-15';

describe('произвольный период', () => {
  it('пресеты ТЗ — от сегодняшнего дня по Москве', () => {
    expect(rangeOf('today', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(rangeOf('yesterday', TODAY)).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(rangeOf('7d', TODAY)).toEqual({ from: '2026-10-09', to: TODAY });
    expect(rangeOf('30d', TODAY)).toEqual({ from: '2026-09-16', to: TODAY });
    expect(rangeOf('month', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(rangeOf('prevmonth', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeOf('prevmonth', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeOf('custom', TODAY)).toBeNull();
  });

  it('динамика: месяц — с прошлым месяцем, остальное — той же длиной перед', () => {
    expect(previousRange({ from: '2026-09-01', to: '2026-09-30' })).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(previousRange({ from: '2026-10-01', to: '2026-10-15' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
    });
    // 31 марта → 28 февраля: в феврале такого числа нет.
    expect(previousRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(previousRange({ from: '2026-03-01', to: '2026-03-30' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(previousRange({ from: '2026-10-09', to: '2026-10-15' })).toEqual({
      from: '2026-10-02',
      to: '2026-10-08',
    });
    expect(previousRange({ from: TODAY, to: TODAY })).toEqual({
      from: '2026-10-14',
      to: '2026-10-14',
    });
  });

  it('проверка: настоящие даты, не задом наперёд, не будущее, не длиннее года', () => {
    expect(isValidRange({ from: '2026-09-01', to: '2026-09-30' }, TODAY)).toBe(true);
    expect(isValidRange({ from: '2026-02-30', to: '2026-03-01' }, TODAY)).toBe(false);
    expect(isValidRange({ from: '2026-09-30', to: '2026-09-01' }, TODAY)).toBe(false);
    expect(isValidRange({ from: '2026-10-01', to: '2026-10-16' }, TODAY)).toBe(false);
    expect(isValidRange({ from: '2025-10-14', to: TODAY }, TODAY)).toBe(false);
    expect(isValidRange({ from: '2025-10-15', to: TODAY }, TODAY)).toBe(true);
  });

  it('ссылка: мусор — null, подпись — датами бота', () => {
    expect(rangeFromQuery({ from: '2026-09-01', to: '2026-09-30' }, TODAY)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(rangeFromQuery({ from: 'x' }, TODAY)).toBeNull();
    expect(rangeLabel({ from: '2026-09-01', to: '2026-09-30' })).toBe('01-09-2026 — 30-09-2026');
    expect(rangeLabel({ from: TODAY, to: TODAY })).toBe('15-10-2026');
    expect(sameRange({ from: 'a', to: 'b' }, { from: 'a', to: 'b' })).toBe(true);
    expect(sameRange(null, null)).toBe(false);
  });
});
