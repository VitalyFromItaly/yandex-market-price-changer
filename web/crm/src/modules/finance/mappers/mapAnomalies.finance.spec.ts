import type { FinanceAnomaly } from '../finance.domain';

import { describe, expect, it } from 'vitest';

import { toAnomaliesModel, toAnomalyRow } from './mapAnomalies.finance';

const item = (over: Partial<FinanceAnomaly> = {}): FinanceAnomaly => ({
  key: 'penalty:k',
  kind: 'penalty',
  kindLabel: 'Штраф',
  threshold: 'любой штраф',
  detail: '«Удержание · Штраф»: 2 строк',
  amountKopecks: -50_000,
  sku: null,
  orderId: null,
  operationIds: ['a', 'b'],
  operationCount: 2,
  reviewed: false,
  ...over,
});

describe('toAnomalyRow', () => {
  it('деньги, операции, ссылка на товар и заказ', () => {
    const row = toAnomalyRow(item({ sku: 'A1', orderId: '55' }));
    expect(row).toMatchObject({
      key: 'penalty:k',
      label: 'Штраф',
      reference: 'Товар A1 · заказ 55',
      operations: '2 операции',
      operationIds: ['a', 'b'],
      reviewed: false,
    });
    expect(row.amount).toMatch(/500/);
  });

  it('без денег и ссылки — null, а не «0 ₽»', () => {
    const row = toAnomalyRow(item({ amountKopecks: null }));
    expect(row.amount).toBeNull();
    expect(row.reference).toBeNull();
  });
});

describe('toAnomaliesModel', () => {
  it('«не проверялся» отличается от «аномалий нет»', () => {
    const never = toAnomaliesModel({ total: 0, unreviewed: 0, checkedAt: null, items: [] });
    expect(never.checkedLabel).toBeNull();
    const clean = toAnomaliesModel({
      total: 0,
      unreviewed: 0,
      checkedAt: '2026-10-15T00:30:00.000Z',
      items: [],
    });
    expect(clean.checkedLabel).toMatch(/^Проверено /);
  });
});
