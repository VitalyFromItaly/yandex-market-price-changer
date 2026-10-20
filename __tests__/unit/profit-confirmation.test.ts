import { describe, expect, it } from 'vitest';

import {
  mergeUnconfirmed,
  unconfirmedOf,
  unconfirmedSummary,
  UNCONFIRMED_PROFIT_LABEL,
} from '../../src/shared/profit-confirmation';

const rub = (kopecks: number) => `${kopecks / 100} ₽`;

describe('profit-confirmation: один признак «прибыль не подтверждена»', () => {
  it('confirmed выводится из счётчиков, а не передаётся', () => {
    expect(unconfirmedOf(0, 0, []).confirmed).toBe(true);
    expect(unconfirmedOf(1, 500, []).confirmed).toBe(false);
    // Артикул без номера заказа (строка журнала) — тоже не подтверждено.
    expect(unconfirmedOf(0, 0, ['A']).confirmed).toBe(false);
  });

  it('артикулы без повторов, пустой — «без артикула»', () => {
    expect(unconfirmedOf(2, 0, ['A', 'A', '']).skus).toEqual(['A', '(без артикула)']);
  });

  it('два набора сливаются в один признак, артикулы не повторяются', () => {
    const merged = mergeUnconfirmed(
      unconfirmedOf(1, 100, ['A']),
      unconfirmedOf(2, 250, ['A', 'B']),
    );
    expect(merged).toEqual({ confirmed: false, orders: 3, revenueKopecks: 350, skus: ['A', 'B'] });
    expect(mergeUnconfirmed(undefined, null).confirmed).toBe(true);
  });

  it('текст называет число заказов и сумму; подтверждённая прибыль — без текста', () => {
    expect(unconfirmedSummary(unconfirmedOf(0, 0, []), rub)).toBeNull();
    expect(unconfirmedSummary(unconfirmedOf(3, 12_300, ['A']), rub)).toBe(
      `${UNCONFIRMED_PROFIT_LABEL}: 3 заказа на 123 ₽ — нет закупа на дату продажи`,
    );
    expect(unconfirmedSummary(unconfirmedOf(1, 100, ['A']), rub, 'нет категории')).toContain(
      '1 заказ на 1 ₽ — нет категории',
    );
    expect(unconfirmedSummary(unconfirmedOf(0, 0, ['A', 'B']), rub)).toContain('2 арт.');
  });
});
