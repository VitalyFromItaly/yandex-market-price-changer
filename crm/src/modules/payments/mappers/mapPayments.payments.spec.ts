import { describe, expect, it } from 'vitest';

import { mapPaymentsOptions, mapPaymentsReport } from './mapPayments.payments';

describe('mapPayments', () => {
  it('опции периода — {value, label} из ответа сервера', () => {
    expect(mapPaymentsOptions({ periods: [{ key: 'week', label: 'Последние 7 дней' }] })).toEqual({
      periods: [{ value: 'week', label: 'Последние 7 дней' }],
    });
  });

  it('готовый отчёт: границы в формате бота, файл', () => {
    expect(
      mapPaymentsReport({
        period: 'prevmonth',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        empty: false,
        emptyText: null,
        filename: 'platezhi.xlsx',
      }),
    ).toEqual({
      period: 'prevmonth',
      caption: '01-07-2026 — 31-07-2026',
      emptyText: null,
      filename: 'platezhi.xlsx',
    });
  });

  it('«данных нет» — отдельное состояние с текстом сервера', () => {
    const report = mapPaymentsReport({
      period: 'week',
      dateFrom: '2026-07-28',
      dateTo: '2026-08-03',
      empty: true,
      emptyText: 'За период 28-07-2026 — 03-08-2026 платежей нет.',
      filename: null,
    });
    expect(report.emptyText).toBe('За период 28-07-2026 — 03-08-2026 платежей нет.');
    expect(report.filename).toBeNull();
  });
});
