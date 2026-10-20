import type { OrdersReportResponse } from '../orders.domain';

import { describe, expect, it } from 'vitest';

import { mapOrdersReport, returnsLine, rowDate } from './mapOrdersReport.orders';

const RESPONSE: OrdersReportResponse = {
  key: 'returning',
  title: 'Едет обратно',
  count: 2,
  totals: { sales: 1130, subsidies: 0, withDelivery: 1130 },
  period: { key: 'month', day: null },
  periodTitle: 'с начала месяца, 01-08-2026 — 03-08-2026',
  takenAt: null,
  assembling: null,
  returns: { count: 1, inFlight: 1, settled: 0, activeOnly: false },
  notes: [],
  emptyText: 'Возвратов и невыкупов нет.',
  rows: [
    {
      orderId: 13,
      type: 'nonRedemption',
      date: '02-08-2026',
      status: 'FULL_NOT_RANSOM',
      items: 'Orient',
      sales: 700,
      subsidies: 0,
      withDelivery: 700,
    },
    {
      orderId: 555,
      type: 'return',
      date: '2026-08-02T23:30:00+00:00',
      status: 'SOMETHING_NEW',
      items: 'D-4 ×3',
      sales: 430,
      subsidies: 0,
      withDelivery: 430,
    },
  ],
  file: { filename: 'edet-obratno-03-08-2026-1000.xlsx', rows: 2, truncated: 0 },
};

describe('mapOrdersReport', () => {
  it('строки: тип, русский статус, неизвестный код как есть, дата по Москве', () => {
    const report = mapOrdersReport(RESPONSE);
    expect(report.hasTypes).toBe(true);
    expect(report.heading).toBe('с начала месяца, 01-08-2026 — 03-08-2026');
    expect(report.rows.map((row) => [row.typeLabel, row.statusLabel, row.date])).toEqual([
      ['Невыкуп', 'Не выкуплен', '02-08-2026'],
      // 23:30 UTC 2 августа — это уже 3 августа в Москве.
      ['Возврат', 'SOMETHING_NEW', '03-08-2026'],
    ]);
    expect(new Set(report.rows.map((row) => row.id)).size).toBe(2);
    expect(report.returnsSplit).toEqual({ inFlight: 1, settled: 0 });
  });

  it('срез печатает момент съёмки', () => {
    const report = mapOrdersReport({
      ...RESPONSE,
      key: 'in_transit',
      periodTitle: null,
      takenAt: '03-08-2026 10:00',
    });
    expect(report.heading).toBe('на 03-08-2026 10:00 МСК');
    expect(report.hasTypes).toBe(false);
  });

  it('разбивка возвратов — слова бота; на «Всего» — только активные', () => {
    expect(returnsLine({ count: 3, inFlight: 2, settled: 1, activeOnly: false })).toBe(
      'Возвраты: 3 — едет 2, выдано магазину 1',
    );
    expect(returnsLine({ count: 3, inFlight: 3, settled: 0, activeOnly: true })).toBe(
      'Активных возвратов: 3 — едут к вам',
    );
    expect(returnsLine(null)).toBeNull();
  });

  it('битая или пустая дата — пусто и в конец сортировки', () => {
    expect(rowDate('')).toEqual({ date: '', dateSort: 0 });
    expect(rowDate('вчера')).toEqual({ date: '', dateSort: 0 });
    expect(rowDate('28-07-2026')).toEqual({ date: '28-07-2026', dateSort: 20260728 });
  });
});
