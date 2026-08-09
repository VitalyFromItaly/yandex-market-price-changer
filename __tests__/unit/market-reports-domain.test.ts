import { describe, it, expect } from 'vitest';

import {
  MARKET_REPORT_KEYS,
  MARKET_REPORT_META,
  MKT_CB_MENU,
  mktCallback,
  mktRateLimitText,
  parseMktCallback,
  realizationMonths,
} from '../../src/modules/yandex/market-reports/market-reports.domain';

describe('Раздел «Отчёты Маркета»: кодек', () => {
  it('ключ отчёта и параметры едут в callback_data и разбираются обратно', () => {
    expect(parseMktCallback(mktCallback('real', 2026, 7))).toEqual({
      key: 'real',
      args: ['2026', '7'],
    });
    expect(parseMktCallback(mktCallback('comp', 12345678, 'prevmonth'))).toEqual({
      key: 'comp',
      args: ['12345678', 'prevmonth'],
    });
    expect(parseMktCallback(MKT_CB_MENU)).toEqual({ key: 'menu', args: [] });
  });

  it('самый длинный callback влезает в 64 байта Telegram', () => {
    // categoryId — int64, до 19 цифр.
    const longest = mktCallback('comp', '9'.repeat(19), 'prevmonth');
    expect(Buffer.byteLength(longest)).toBeLessThanOrEqual(64);
  });

  it('мусор не разбирается', () => {
    expect(parseMktCallback('mkt:unknown')).toBeNull();
    expect(parseMktCallback('mkt:real:июль')).toBeNull();
    expect(parseMktCallback('rep:month:profit')).toBeNull();
    expect(parseMktCallback(undefined)).toBeNull();
  });

  it('у каждого отчёта реестра есть заголовок и эмодзи', () => {
    for (const key of MARKET_REPORT_KEYS) {
      expect(MARKET_REPORT_META[key].title).toBeTruthy();
      expect(MARKET_REPORT_META[key].emoji).toBeTruthy();
    }
  });

  it('квота 10/час объявлена ровно у конкурентов и аналитики продаж', () => {
    const limited = MARKET_REPORT_KEYS.filter((key) => MARKET_REPORT_META[key].hourlyLimit);
    expect(limited.sort()).toEqual(['comp', 'shows']);
    expect(mktRateLimitText('comp')).toContain('10 запросами в час');
  });

  it('оборачиваемость помечена как FBY-only', () => {
    expect(MARKET_REPORT_META.turn.fbyOnly).toBe(true);
  });
});

describe('Раздел «Отчёты Маркета»: месяцы реализации', () => {
  it('предлагаются два последних ЗАВЕРШЁННЫХ месяца', () => {
    // 15-08-2026 МСК → июль и июнь; текущий август не предлагается.
    const months = realizationMonths(new Date('2026-08-15T09:00:00Z'));
    expect(months.map((m) => [m.year, m.month])).toEqual([
      [2026, 7],
      [2026, 6],
    ]);
    expect(months[0].label).toBe('Июль 2026');
  });

  it('в январе месяцы пересекают границу года', () => {
    const months = realizationMonths(new Date('2027-01-05T09:00:00Z'));
    expect(months.map((m) => [m.year, m.month])).toEqual([
      [2026, 12],
      [2026, 11],
    ]);
    expect(months[0].label).toBe('Декабрь 2026');
  });
});
