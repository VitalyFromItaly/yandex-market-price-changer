import type { CostChange, CostHistoryView, CostRecord } from '../accounting.domain';

/** Запись прайса с секундами — как пишет загрузка; исправление должно попасть ровно в неё. */
export function costRecord(over: Partial<CostRecord> = {}): CostRecord {
  return {
    id: 'r1',
    validFrom: '2026-10-01T09:15:42.123Z',
    purchase: { price: 1000, currency: 'RUR', rate: null, extraCosts: null },
    source: 'price-list',
    sourceLabel: 'Прайс',
    author: null,
    ...over,
  };
}

export function costChange(over: Partial<CostChange> = {}): CostChange {
  return {
    id: 'c1',
    action: 'correct',
    actionLabel: 'Исправлена цена',
    before: {
      validFrom: '2026-10-01T09:15:42.123Z',
      purchase: { price: 1000, currency: 'RUR', rate: null, extraCosts: null },
    },
    after: {
      validFrom: '2026-10-01T09:15:42.123Z',
      purchase: { price: 12.5, currency: 'USD', rate: 90, extraCosts: 40 },
    },
    author: '222',
    impersonatedBy: null,
    reason: 'Счёт поставщика',
    createdAt: '2026-11-10T12:00:00.000Z',
    ...over,
  };
}

export function costHistoryView(over: Partial<CostHistoryView> = {}): CostHistoryView {
  return { records: [costRecord()], changes: [], ...over };
}
