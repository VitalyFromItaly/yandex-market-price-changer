import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  moscowClock,
  moscowDay,
  moscowOffset,
  moscowStamp,
} from '../../src/modules/yandex/reports/moscow-day';
import { financeToday } from '../../src/modules/finance/finance-period';

describe('moscow-day: форматтеры Intl одни на процесс', () => {
  afterEach(() => vi.restoreAllMocks());

  // 15.11.2026: новый Intl.DateTimeFormat на строку журнала — RSS 2,7 ГБ на 34 тыс. строк.
  it('вызовы на каждую строку журнала не создают Intl.DateTimeFormat', () => {
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    const at = new Date('2026-11-14T21:30:00Z');
    for (let i = 0; i < 50; i++) {
      financeToday(at);
      moscowDay(at);
      moscowOffset(at);
      moscowClock(at);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('значения прежние: 21:30 UTC — уже следующие сутки в Москве', () => {
    const at = new Date('2026-11-14T21:30:00Z');
    expect(financeToday(at)).toBe('2026-11-15');
    expect(moscowDay(at)).toEqual({ year: 2026, month: 11, day: 15, offset: '+03:00' });
    expect(moscowClock(at)).toBe('00:30');
    expect(moscowStamp(at)).toBe('15-11-2026 00:30');
  });
});
