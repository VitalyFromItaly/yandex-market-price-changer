import { describe, expect, it } from 'vitest';

import { orderDayIso } from '../../src/modules/yandex/reports/order-day';

/** День заказа для ряда «по дням» прибыли — из каждой формы даты Маркета. */
describe('orderDayIso', () => {
  it('живой getOrders: ДД-ММ-ГГГГ ЧЧ:ММ:СС уже по Москве — переставляются части', () => {
    // 23:30 МСК остаётся тем же днём: строка не разбирается как UTC.
    expect(orderDayIso('31-08-2026 23:30:00')).toBe('2026-08-31');
    expect(orderDayIso('01-08-2026')).toBe('2026-08-01');
  });

  it('архив stats/orders: ГГГГ-ММ-ДД', () => {
    expect(orderDayIso('2026-08-05')).toBe('2026-08-05');
  });

  it('ISO без смещения (statusUpdateDate) — московское время, день по префиксу', () => {
    expect(orderDayIso('2026-08-05T23:59:00')).toBe('2026-08-05');
  });

  it('ISO с Z или смещением — день по Москве, а не по UTC', () => {
    // 22:00 UTC — это уже 01:00 следующих суток в Москве.
    expect(orderDayIso('2026-08-05T22:00:00Z')).toBe('2026-08-06');
    expect(orderDayIso('2026-08-05T22:00:00+03:00')).toBe('2026-08-05');
  });

  it('мусор и невозможные даты — null', () => {
    expect(orderDayIso(undefined)).toBeNull();
    expect(orderDayIso('')).toBeNull();
    expect(orderDayIso('вчера')).toBeNull();
    expect(orderDayIso('31-02-2026 10:00:00')).toBeNull();
    expect(orderDayIso('2026-13-01')).toBeNull();
  });
});
