import { describe, expect, it } from 'vitest';

import { openPriceListTabs } from './usePriceListTabs.price-list';

import { resolveTab } from '@/shared/composables';

describe('вкладки «Прайса»', () => {
  it('обе фичи — обе вкладки, загрузка первой', () => {
    const open = openPriceListTabs({ purchase_prices: true, stock_update: true });
    expect(open.map((tab) => tab.key)).toEqual(['upload', 'prices']);
  });

  it('только остатки — список закупа скрыт, он вёл бы в 403', () => {
    const open = openPriceListTabs({ purchase_prices: false, stock_update: true });
    expect(open.map((tab) => tab.key)).toEqual(['upload']);
    expect(resolveTab('prices', open)?.key).toBe('upload');
  });

  it('всё закрыто — вкладок нет', () => {
    expect(openPriceListTabs({ purchase_prices: false, stock_update: false })).toEqual([]);
    expect(openPriceListTabs(undefined)).toEqual([]);
  });
});
