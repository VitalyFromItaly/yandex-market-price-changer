import { describe, expect, it } from 'vitest';

import {
  dayToIso,
  isoToDay,
  minDayIso,
  moscowTodayIso,
  periodFromQuery,
  periodParams,
  periodQuery,
  samePeriod,
} from './period';

// 22:30 UTC 2 августа — уже 3 августа в Москве.
const NOW = new Date('2026-08-02T22:30:00Z');

describe('период отчёта', () => {
  it('сегодня и нижняя граница — по Москве, 30 дней без архива', () => {
    expect(moscowTodayIso(NOW)).toBe('2026-08-03');
    expect(minDayIso(false, NOW)).toBe('2026-07-04');
    expect(minDayIso(true, NOW)).toBeNull();
  });

  it('формат поля даты ↔ формат бота', () => {
    expect(isoToDay('2026-07-28')).toBe('28-07-2026');
    expect(isoToDay('')).toBeNull();
    expect(dayToIso('28-07-2026')).toBe('2026-07-28');
    expect(dayToIso(null)).toBe('');
  });

  it('params задачи: день только у «Другого дня»', () => {
    expect(periodParams({ key: 'month', day: null })).toEqual({ period: { key: 'month' } });
    expect(periodParams({ key: 'day', day: '28-07-2026' })).toEqual({
      period: { key: 'day', day: '28-07-2026' },
    });
  });

  it('эхо периода: дни сравниваются только у «Другого дня»', () => {
    expect(samePeriod({ key: 'week', day: null }, { key: 'week', day: null })).toBe(true);
    expect(samePeriod({ key: 'day', day: '01-08-2026' }, { key: 'day', day: '02-08-2026' })).toBe(
      false,
    );
    expect(samePeriod({ key: 'today', day: null }, { key: 'week', day: null })).toBe(false);
  });

  it('период в ссылке: туда и обратно', () => {
    for (const period of [
      { key: 'today', day: null },
      { key: 'month', day: null },
      { key: 'all', day: null },
      { key: 'day', day: '28-07-2026' },
    ] as const) {
      expect(periodFromQuery(periodQuery(period))).toEqual(period);
    }
    expect(periodQuery({ key: 'all', day: null })).toEqual({ period: 'all' });
  });

  it('мусор в ссылке — null, страница остаётся на своём периоде', () => {
    expect(periodFromQuery({})).toBeNull();
    expect(periodFromQuery({ period: 'year' })).toBeNull();
    expect(periodFromQuery({ period: 'day' })).toBeNull();
    expect(periodFromQuery({ period: 'day', day: '2026-07-28' })).toBeNull();
    expect(periodFromQuery({ period: ['week', 'month'] })).toEqual({ key: 'week', day: null });
  });
});
