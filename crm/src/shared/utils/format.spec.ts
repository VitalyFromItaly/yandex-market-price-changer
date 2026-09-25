import { describe, expect, it } from 'vitest';

import { formatCount, formatMoscowDate, formatRub, formatSavedAt } from './format';

/** Intl ставит узкий неразрывный пробел между разрядами — сравниваем без него. */
const plain = (text: string): string => text.replace(/[\u00A0\u202F]/g, ' ');

describe('formatRub / formatCount', () => {
  it('разряды, копейки только при наличии, знак рубля', () => {
    expect(plain(formatRub(1234567))).toBe('1 234 567 ₽');
    expect(plain(formatRub(2500.5))).toBe('2 500,5 ₽');
    expect(plain(formatRub(0))).toBe('0 ₽');
  });

  it('штуки без дробей', () => {
    expect(plain(formatCount(12345))).toBe('12 345');
  });
});

describe('formatMoscowDate', () => {
  it('ДД-ММ-ГГГГ по Москве: 22:30 UTC — уже следующий день', () => {
    expect(formatMoscowDate('2026-09-23T22:30:00.000Z')).toBe('24-09-2026');
  });

  it('битая строка — null', () => {
    expect(formatMoscowDate('nope')).toBeNull();
  });
});

describe('formatSavedAt', () => {
  const now = new Date('2026-09-25T09:00:00Z'); // 12:00 МСК

  it('сегодня по Москве — только время', () => {
    expect(formatSavedAt('2026-09-25T07:32:00Z', now)).toBe('10:32');
  });

  it('другой день — с датой, как в боте', () => {
    expect(formatSavedAt('2026-09-24T11:05:00Z', now)).toBe('24-09-2026 14:05');
  });

  it('битая строка — null', () => {
    expect(formatSavedAt('вчера', now)).toBeNull();
  });
});
