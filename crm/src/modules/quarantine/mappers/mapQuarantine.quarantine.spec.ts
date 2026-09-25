import { describe, expect, it } from 'vitest';

import { confirmSummary, mapQuarantineRow, mapQuarantineView } from './mapQuarantine.quarantine';

describe('mapQuarantine', () => {
  it('отсутствующая цена остаётся null, не 0', () => {
    const row = mapQuarantineRow({
      offerId: 'A',
      verdicts: [
        {
          type: 'LOW_PRICE',
          title: 'цена сильно ниже рыночной',
          currentPrice: 100,
          lastValidPrice: null,
          minPrice: 900,
        },
      ],
    });
    expect(row).toEqual({
      offerId: 'A',
      reasons: ['цена сильно ниже рыночной'],
      currentPrice: 100,
      lastValidPrice: null,
      minPrice: 900,
    });
  });

  it('несколько причин: подписи списком, цены — первые известные', () => {
    const row = mapQuarantineRow({
      offerId: 'B',
      verdicts: [
        { type: 'X', title: 'x', currentPrice: null, lastValidPrice: 5000, minPrice: null },
        { type: 'Y', title: 'y', currentPrice: 1000, lastValidPrice: null, minPrice: 800 },
      ],
    });
    expect(row).toMatchObject({
      reasons: ['x', 'y'],
      currentPrice: 1000,
      lastValidPrice: 5000,
      minPrice: 800,
    });
  });

  it('вид — пояснение и оговорка сервера как есть', () => {
    const view = mapQuarantineView({
      businessName: 'SBrand',
      explainer: ['a'],
      note: 'n',
      offers: [],
    });
    expect(view).toEqual({ explainer: ['a'], note: 'n', rows: [] });
  });

  it('итог подтверждения называет ушедшие из карантина, только если они есть', () => {
    expect(confirmSummary({ confirmed: 2, stale: 0 })).toBe('Товаров вернётся на витрину: 2.');
    expect(confirmSummary({ confirmed: 1, stale: 1 })).toContain('Уже не в карантине: 1.');
  });
});
