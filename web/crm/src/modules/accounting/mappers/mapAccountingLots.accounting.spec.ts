import { describe, expect, it } from 'vitest';

import { lotResponse } from './accountingLots.fixtures.accounting';
import { mapAccountingLots, toAccountingLotRow } from './mapAccountingLots.accounting';

describe('mapAccountingLots', () => {
  it('партия → подписи: товар, закупка, штуки, цена с доп. расходами', () => {
    const row = toAccountingLotRow(lotResponse());
    expect(row).toMatchObject({
      key: 'L1',
      productLabel: 'Часы',
      skuLabel: 'A1',
      unmatchedNote: null,
      supplierLabel: 'ООО Восток',
      soldOut: false,
    });
    expect(row.countLabel).toMatch(/^3 шт\.$/);
    expect(row.remainingLabel).toMatch(/^1 шт\.$/);
    expect(row.unitCostLabel).toContain('1');
    expect(row.unitCostNote).toMatch(/^Закуп .+ \+ доп\. расходы$/);
  });

  it('без доп. расходов — без пометки; без имени — артикул; распродана — приглушена', () => {
    const row = toAccountingLotRow(
      lotResponse({ extraKopecks: 0, name: null, remaining: 0, productMatched: false }),
    );
    expect(row.unitCostNote).toBeNull();
    expect(row.productLabel).toBe('A1');
    expect(row.soldOut).toBe(true);
    expect(row.unmatchedNote).toContain('не сопоставлен');
  });

  it('итог остатка — с сервера, не пересчитывается', () => {
    const view = mapAccountingLots({
      lots: [lotResponse(), lotResponse({ lotId: 'L2' })],
      totals: { remaining: 7, remainingCostKopecks: 500_000 },
    });
    expect(view.rows.map((r) => r.key)).toEqual(['L1', 'L2']);
    expect(view.totalsLabel).toMatch(/^В остатке 7 шт\. на /);
  });
});
