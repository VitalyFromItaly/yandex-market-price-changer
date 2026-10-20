import type {
  AllocationRange,
  ExpenseAllocation,
  ExpenseAllocationResponse,
  ExpenseBody,
  ExpensesResponse,
  ExpensesView,
} from '../expenses.domain';

import { http } from '@/shared/http';

const BASE = '/ym/expenses';

/** Каждая запись отвечает полным видом раздела: таблица рисуется с сервера, не с формы. */
export const expensesApi = {
  get: (): Promise<ExpensesView> => http.get<ExpensesResponse>(BASE),

  create: (body: ExpenseBody): Promise<ExpensesView> => http.post<ExpensesResponse>(BASE, body),

  update: (id: string, body: ExpenseBody): Promise<ExpensesView> =>
    http.put<ExpensesResponse>(`${BASE}/${encodeURIComponent(id)}`, body),

  remove: (id: string): Promise<ExpensesView> =>
    http.delete<ExpensesResponse>(`${BASE}/${encodeURIComponent(id)}`),

  addCategory: (name: string): Promise<ExpensesView> =>
    http.post<ExpensesResponse>(`${BASE}/categories`, { name }),

  removeCategory: (id: string): Promise<ExpensesView> =>
    http.delete<ExpensesResponse>(`${BASE}/categories/${encodeURIComponent(id)}`),

  allocation: (range: AllocationRange): Promise<ExpenseAllocation> =>
    http.get<ExpenseAllocationResponse>(
      `${BASE}/allocation?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    ),
};
