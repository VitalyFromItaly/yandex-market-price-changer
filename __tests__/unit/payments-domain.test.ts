import { describe, it, expect } from 'vitest';

import {
  parsePayCallback,
  payCallback,
  paymentsCaption,
  paymentsFileName,
  paymentsRange,
} from '../../src/modules/yandex/payments/payments.domain';

/**
 * Границы периодов считаются по МОСКОВСКОМУ календарю, на фиксированных `now`:
 * первое число месяца и переход года — ровно те места, где мс-арифметика
 * промахивается на день.
 */
describe('Периоды отчёта по платежам', () => {
  // 15-08-2026 12:00 МСК.
  const MIDDLE = new Date('2026-08-15T09:00:00Z');

  it('week — последние 7 календарных дней включительно', () => {
    expect(paymentsRange('week', MIDDLE)).toEqual({
      dateFrom: '2026-08-09',
      dateTo: '2026-08-15',
    });
  });

  it('month — с 1 числа по сегодня', () => {
    expect(paymentsRange('month', MIDDLE)).toEqual({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-15',
    });
  });

  it('prevmonth — прошлый месяц целиком', () => {
    expect(paymentsRange('prevmonth', MIDDLE)).toEqual({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
  });

  it('1-е число: month — один день, week уходит в прошлый месяц', () => {
    const first = new Date('2026-08-01T09:00:00Z');
    expect(paymentsRange('month', first)).toEqual({ dateFrom: '2026-08-01', dateTo: '2026-08-01' });
    expect(paymentsRange('week', first)).toEqual({ dateFrom: '2026-07-26', dateTo: '2026-08-01' });
  });

  it('январь: prevmonth пересекает границу года', () => {
    const january = new Date('2027-01-05T09:00:00Z');
    expect(paymentsRange('prevmonth', january)).toEqual({
      dateFrom: '2026-12-01',
      dateTo: '2026-12-31',
    });
  });

  it('поздний вечер по Москве — это уже завтра относительно UTC', () => {
    // 22:30 МСК 15-го = 19:30 UTC 15-го; а 00:30 МСК 16-го = 21:30 UTC 15-го.
    const lateEvening = new Date('2026-08-15T21:30:00Z');
    expect(paymentsRange('month', lateEvening).dateTo).toBe('2026-08-16');
  });
});

describe('Кодек кнопок платежей', () => {
  it('три периода кодируются и разбираются', () => {
    for (const period of ['week', 'month', 'prevmonth'] as const) {
      expect(parsePayCallback(payCallback(period))).toBe(period);
    }
  });

  it('мусор не разбирается', () => {
    expect(parsePayCallback('pay:year')).toBeNull();
    expect(parsePayCallback('pay:')).toBeNull();
    expect(parsePayCallback(undefined)).toBeNull();
  });
});

describe('Подпись и имя файла', () => {
  const NOW = new Date('2026-08-15T09:12:00Z'); // 12:12 МСК
  const RANGE = { dateFrom: '2026-08-01', dateTo: '2026-08-15' };

  it('подпись несёт период и момент сборки', () => {
    const caption = paymentsCaption(RANGE, NOW);
    expect(caption).toContain('01-08-2026 — 15-08-2026');
    expect(caption).toContain('12:12 МСК');
  });

  it('имя файла несёт период и время — против дедупликации Telegram', () => {
    expect(paymentsFileName(RANGE, NOW)).toBe('platezhi-01-08-2026-15-08-2026-1212.xlsx');
  });
});
