import { describe, expect, it } from 'vitest';

import { moscowToday, presetRange, toAllocationModel } from './mapAllocation.expenses';

const NBSP = String.fromCharCode(0xa0);

describe('presetRange', () => {
  it('этот и прошлый месяц — целиком, через границу года', () => {
    expect(presetRange('month', '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('prevmonth', '2026-10-15')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(presetRange('prevmonth', '2026-01-10')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('неделя — понедельник…воскресенье, и в воскресенье тоже', () => {
    expect(presetRange('week', '2026-10-15')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(presetRange('week', '2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(presetRange('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });
});

describe('moscowToday', () => {
  it('календарь Москвы, а не UTC: 22:30 UTC — уже следующий день', () => {
    expect(moscowToday(new Date('2026-10-15T22:30:00Z'))).toBe('2026-10-16');
  });
});

describe('toAllocationModel', () => {
  it('рубли из копеек, диапазон подписью; ноль — «пусто»', () => {
    const model = toAllocationModel({
      from: '2026-10-05',
      to: '2026-10-11',
      totalKopecks: 677_419,
      byCategory: [{ key: 'rent', label: 'Аренда', kopecks: 677_419 }],
    });
    expect(model).toEqual({
      rangeLabel: '05-10-2026 — 11-10-2026',
      total: `6${NBSP}774,19${NBSP}₽`,
      isEmpty: false,
      byCategory: [{ key: 'rent', label: 'Аренда', amount: `6${NBSP}774,19${NBSP}₽` }],
    });
    expect(
      toAllocationModel({ from: '2026-10-01', to: '2026-10-31', totalKopecks: 0, byCategory: [] })
        .isEmpty,
    ).toBe(true);
  });
});
