import { describe, expect, it, vi } from 'vitest';

import { ymStockLevels } from '../../src/modules/marketplaces/marketplace-stocks';

import { toCrmStocksView } from '../../src/modules/crm/stocks/crm-stocks.domain';
import {
  fbyStockLevels,
  LOW_STOCK_THRESHOLD,
  storeStockLevels,
} from '../../src/modules/yandex/stocks/stock-levels';
import { StockLevelsService } from '../../src/modules/yandex/stocks/stock-levels.service';

const totals = (available: number) =>
  ({ AVAILABLE: available, FIT: available + 1 }) as Record<string, number>;

describe('остатки по артикулам (только чтение)', () => {
  it('FBY: AVAILABLE суммируется по складам Маркета', () => {
    const levels = fbyStockLevels([
      { sku: 'A', name: 'A', warehouse: 'Ростов', totals: totals(2) },
      { sku: 'A', name: 'A', warehouse: 'Москва', totals: totals(3) },
      { sku: 'B', name: 'B', warehouse: 'Москва', totals: totals(0) },
    ] as never);
    expect(levels).toEqual({ A: 5, B: 0 });
  });

  it('FBS: только свои склады; AVAILABLE, без него FIT, без обоих 0', () => {
    const levels = storeStockLevels(
      [
        {
          warehouseId: 1,
          offerId: 'A',
          stocks: [
            { type: 'FIT', count: 4 },
            { type: 'AVAILABLE', count: 3 },
          ],
        },
        { warehouseId: 2, offerId: 'A', stocks: [{ type: 'FIT', count: 2 }] },
        // Склад возвратов Маркета — товар там не продаётся.
        { warehouseId: 99, offerId: 'A', stocks: [{ type: 'AVAILABLE', count: 50 }] },
        { warehouseId: 1, offerId: 'B', stocks: [{ type: 'DEFECT', count: 1 }] },
      ],
      new Set([1, 2]),
    );
    expect(levels).toEqual({ A: 5, B: 0 });
  });

  it('список своих складов пуст — отсеивать не по чему', () => {
    expect(
      storeStockLevels(
        [{ warehouseId: 5, offerId: 'A', stocks: [{ type: 'FIT', count: 1 }] }],
        new Set(),
      ),
    ).toEqual({ A: 1 });
  });

  it('порог «на исходе» — 3 штуки (решение crm_low_stock_threshold)', () => {
    expect(LOW_STOCK_THRESHOLD).toBe(3);
  });
});

describe('StockLevelsService', () => {
  const STORE = {
    telegramUserId: '1',
    token: 't',
    campaign_id: '10',
    business_id: '20',
  };

  function setup(placement: string | undefined) {
    const client = {
      loadStocks: vi.fn(async () => [
        { warehouseId: 1, offerId: 'A', stocks: [{ type: 'AVAILABLE', count: 2 }] },
      ]),
      listStoreWarehouses: vi.fn(async () => [{ id: 1 }]),
      updateStocks: vi.fn(),
    };
    const fbyStock = {
      safeLoad: vi.fn(async () => ({
        snapshot: {
          takenAt: new Date('2026-10-13T07:00:00Z'),
          summary: { rows: [{ sku: 'F', warehouse: 'X', totals: totals(4) }] },
        },
      })),
    };
    const stockSync = { placementFor: vi.fn(async () => placement) };
    const errors = { report: vi.fn(async () => undefined) };
    const service = new StockLevelsService(
      { forTenant: () => client } as never,
      fbyStock as never,
      stockSync as never,
      errors as never,
    );
    return { service, client, fbyStock, stockSync };
  }

  it('FBY → снимок FbyStockService, offers/stocks не зовётся', async () => {
    const { service, client, fbyStock } = setup(undefined);
    const store = { ...STORE, stores: [{ campaignId: '10', placementType: 'FBY' }] };
    const levels = await service.levels(store as never);
    expect(fbyStock.safeLoad).toHaveBeenCalledTimes(1);
    expect(client.loadStocks).not.toHaveBeenCalled();
    expect(levels.stocks).toEqual({ F: 4 });
    expect(toCrmStocksView(ymStockLevels(levels))).toMatchObject({ fby: true, threshold: 3, problem: null });
  });

  it('FBS по живому placementFor → offers/stocks, запись не трогается', async () => {
    const { service, client, fbyStock } = setup('FBS');
    const levels = await service.levels(STORE as never, new Date('2026-10-13T08:00:00Z'));
    expect(fbyStock.safeLoad).not.toHaveBeenCalled();
    expect(client.updateStocks).not.toHaveBeenCalled();
    expect(levels).toEqual({
      placement: 'FBS',
      takenAt: new Date('2026-10-13T08:00:00Z'),
      stocks: { A: 2 },
    });
  });

  it('сбой чтения — не падение, а причина текстом', async () => {
    const { service, client } = setup('FBS');
    client.loadStocks.mockRejectedValueOnce(new Error('boom'));
    const view = toCrmStocksView(ymStockLevels(await service.levels(STORE as never)));
    expect(view.stocks).toBeNull();
    expect(view.problem).toBe('Остатки временно недоступны.');
  });
});
