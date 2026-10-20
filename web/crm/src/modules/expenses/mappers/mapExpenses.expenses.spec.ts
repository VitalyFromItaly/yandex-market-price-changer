import type { Expense } from '../expenses.domain';

import { describe, expect, it } from 'vitest';

import { expenseBody, mapExpenseError, toExpenseForm, toExpenseRow } from './mapExpenses.expenses';

import { ApiError } from '@/shared/http';

const NBSP = String.fromCharCode(0xa0);

const rent: Expense = {
  id: 'e1',
  kind: 'monthly',
  category: 'rent',
  categoryLabel: 'Аренда',
  amountKopecks: 3_000_050,
  fromDay: '2026-10-01',
  toDay: null,
  note: null,
};

describe('toExpenseRow', () => {
  it('ежемесячный без конца: «с …», сумма в месяц', () => {
    expect(toExpenseRow(rent)).toEqual({
      id: 'e1',
      categoryLabel: 'Аренда',
      kindLabel: 'Ежемесячно',
      whenLabel: 'с 01-10-2026',
      amount: `30${NBSP}000,5${NBSP}₽`,
      amountSuffix: 'в месяц',
      note: null,
    });
  });

  it('с концом — диапазон; разовый — один день без «в месяц»', () => {
    expect(toExpenseRow({ ...rent, toDay: '2026-12-31' }).whenLabel).toBe(
      '01-10-2026 — 31-12-2026',
    );
    const once = toExpenseRow({ ...rent, kind: 'one_off', fromDay: '2026-10-15' });
    expect(once).toMatchObject({
      whenLabel: '15-10-2026',
      kindLabel: 'Разово',
      amountSuffix: null,
    });
  });
});

describe('форма расхода', () => {
  it('новый — ежемесячная аренда с сегодняшнего дня; правка — значения записи', () => {
    expect(toExpenseForm(null, '2026-10-15')).toEqual({
      kind: 'monthly',
      category: 'rent',
      amount: '',
      fromDay: '2026-10-15',
      toDay: '',
      note: '',
    });
    expect(toExpenseForm({ ...rent, note: 'склад' }, '2026-10-15')).toMatchObject({
      amount: '30000,5',
      toDay: '',
      note: 'склад',
    });
  });

  it('тело: пустой конец и заметка — null; у разового конца нет', () => {
    const form = toExpenseForm(rent, '2026-10-15');
    expect(expenseBody({ ...form, note: '  ' })).toMatchObject({ toDay: null, note: null });
    expect(expenseBody({ ...form, kind: 'one_off', toDay: '2026-12-31' }).toDay).toBeNull();
    expect(expenseBody({ ...form, toDay: '2026-12-31' }).toDay).toBe('2026-12-31');
  });
});

describe('mapExpenseError', () => {
  it('INVALID_EXPENSE с известным полем — под поле, иначе общей строкой', () => {
    const field = new ApiError('Сумма должна быть больше нуля', 400, 'INVALID_EXPENSE', 'amount');
    expect(mapExpenseError(field, 'x')).toEqual({ amount: 'Сумма должна быть больше нуля' });
    const period = new ApiError('Период', 400, 'INVALID_EXPENSE', 'period');
    expect(mapExpenseError(period, 'x')).toEqual({ form: 'Период' });
    expect(mapExpenseError('boom', 'Не удалось')).toEqual({ form: 'Не удалось' });
  });
});
