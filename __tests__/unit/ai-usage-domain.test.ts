import { describe, it, expect } from 'vitest';

import {
  errorShare,
  fillDays,
  isAiUsageRange,
  moscowDayKey,
  moscowDays,
} from '../../src/modules/ai/ai-usage.domain';

describe('ai-usage.domain', () => {
  it('окна: 24h, 7d, 30d; прочее — нет', () => {
    expect(['24h', '7d', '30d'].every(isAiUsageRange)).toBe(true);
    expect(isAiUsageRange('1y')).toBe(false);
    expect(isAiUsageRange('toString')).toBe(false);
  });

  it('день — по Москве, а не по UTC', () => {
    // 22:30 UTC — это уже 01:30 следующего дня в Москве.
    expect(moscowDayKey(new Date('2026-10-13T22:30:00Z'))).toBe('2026-10-14');
  });

  it('сутки с 15:00 до 15:00 задевают два дня', () => {
    expect(moscowDays(new Date('2026-10-13T12:00:00Z'), new Date('2026-10-14T12:00:00Z'))).toEqual([
      '2026-10-13',
      '2026-10-14',
    ]);
  });

  it('неделя — восемь календарных дней, без пропусков и повторов', () => {
    const days = moscowDays(new Date('2026-10-07T09:00:00Z'), new Date('2026-10-14T09:00:00Z'));
    expect(days).toHaveLength(8);
    expect(new Set(days).size).toBe(8);
    expect(days[0]).toBe('2026-10-07');
    expect(days[7]).toBe('2026-10-14');
  });

  it('пустые дни добиваются нулями, порядок — по дням окна', () => {
    const filled = fillDays(
      ['2026-10-12', '2026-10-13', '2026-10-14'],
      [{ day: '2026-10-14', costRub: 1.5, requests: 3, errors: 1 }],
    );
    expect(filled.map((d) => d.costRub)).toEqual([0, 0, 1.5]);
    expect(filled[0]).toEqual({ day: '2026-10-12', costRub: 0, requests: 0, errors: 0 });
  });

  it('доля ошибок; без запросов — null, а не 0', () => {
    expect(errorShare(1, 4)).toBe(0.25);
    expect(errorShare(0, 0)).toBeNull();
  });
});
