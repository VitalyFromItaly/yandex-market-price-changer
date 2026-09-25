import type { OrderRow } from '../orders.domain';

import { describe, expect, it } from 'vitest';

import { filterRows, nextSort, sortRows } from './ordersTable.orders';

const row = (
  orderId: number,
  dateSort: number,
  sales: number,
  items = '',
  status = '',
): OrderRow => ({
  id: String(orderId),
  orderId,
  typeLabel: 'Заказ',
  date: '',
  dateSort,
  statusLabel: status,
  items,
  sales,
  subsidies: 0,
  withDelivery: sales,
});

const ROWS = [
  row(1, 20260801, 500, 'Casio G-Shock', 'В доставке'),
  row(2, 20260803, 1500, 'Восток Амфибия', 'Доставлен'),
  row(3, 20260802, 900, 'Orient', 'В доставке'),
];

describe('таблица заказов', () => {
  it('поиск по номеру, составу и статусу без регистра', () => {
    expect(filterRows(ROWS, 'восток').map((r) => r.orderId)).toEqual([2]);
    expect(filterRows(ROWS, '3').map((r) => r.orderId)).toEqual([3]);
    expect(filterRows(ROWS, 'в доставке').map((r) => r.orderId)).toEqual([1, 3]);
    expect(filterRows(ROWS, '  ')).toHaveLength(3);
  });

  it('день с графика сужает таблицу и складывается с поиском', () => {
    expect(filterRows(ROWS, '', 20260802).map((r) => r.orderId)).toEqual([3]);
    expect(filterRows(ROWS, 'в доставке', 20260801).map((r) => r.orderId)).toEqual([1]);
    expect(filterRows(ROWS, 'восток', 20260801)).toEqual([]);
  });

  it('сортировка по дате и деньгам в обе стороны, исходник не мутирует', () => {
    expect(sortRows(ROWS, 'date', 'desc').map((r) => r.orderId)).toEqual([2, 3, 1]);
    expect(sortRows(ROWS, 'sales', 'asc').map((r) => r.orderId)).toEqual([1, 3, 2]);
    expect(sortRows(ROWS, 'status', 'asc').map((r) => r.orderId)).toEqual([1, 3, 2]);
    expect(ROWS.map((r) => r.orderId)).toEqual([1, 2, 3]);
  });

  it('клик по активной колонке переворачивает, по новой — деньги по убыванию', () => {
    expect(nextSort({ key: 'date', dir: 'desc' }, 'date')).toEqual({ key: 'date', dir: 'asc' });
    expect(nextSort({ key: 'date', dir: 'desc' }, 'sales')).toEqual({ key: 'sales', dir: 'desc' });
    expect(nextSort({ key: 'date', dir: 'desc' }, 'status')).toEqual({
      key: 'status',
      dir: 'asc',
    });
  });
});
