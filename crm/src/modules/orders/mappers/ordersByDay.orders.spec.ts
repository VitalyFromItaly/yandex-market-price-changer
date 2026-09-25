import type { OrderRow } from '../orders.domain';

import { describe, expect, it } from 'vitest';

import { MAX_DAYS, ordersByDay, worthCharting } from './ordersByDay.orders';

const row = (dateSort: number, sales: number): OrderRow => ({
  id: `${dateSort}:${sales}`,
  orderId: 1,
  typeLabel: '',
  date: '',
  dateSort,
  statusLabel: '',
  items: '',
  sales,
  subsidies: 0,
  withDelivery: sales,
});

describe('ordersByDay', () => {
  it('группирует по дню и заполняет пропуски нулями', () => {
    const { points, undated } = ordersByDay([
      row(20260930, 100),
      row(20261002, 50),
      row(20260930, 25),
      row(0, 999),
    ]);
    expect(points.map((p) => [p.label, p.count, p.sales])).toEqual([
      ['30-09', 2, 125],
      ['01-10', 0, 0],
      ['02-10', 1, 50],
    ]);
    expect(points[0]?.date).toBe('30-09-2026');
    expect(undated).toBe(1);
  });

  it('сумма столбцов равна сумме датированных строк', () => {
    const rows = [row(20260901, 10), row(20260915, 20), row(20260920, 30)];
    const total = ordersByDay(rows).points.reduce((sum, p) => sum + p.sales, 0);
    expect(total).toBe(60);
  });

  it('один день — не ряд; пусто — пусто', () => {
    expect(worthCharting(ordersByDay([row(20260901, 1), row(20260901, 2)]))).toBe(false);
    expect(ordersByDay([]).points).toEqual([]);
  });

  it('длинный ряд обрезается потолком — остаются последние дни', () => {
    const byDay = ordersByDay([row(20250101, 1), row(20261231, 1)]);
    expect(byDay.points).toHaveLength(MAX_DAYS);
    expect(byDay.points.at(-1)?.date).toBe('31-12-2026');
    expect(byDay.clipped).toBeGreaterThan(0);
  });
});
