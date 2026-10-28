import type { StockPushPlan, StockPushTarget } from '../price-list.domain';

import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';

import { usePushSelection } from './usePushSelection.price-list';

const ROW = { internalSku: 'A', name: null, sku: 'A', from: 5, to: 3, priceListStock: 5, sold: 2 };

function target(over: Partial<StockPushTarget>): StockPushTarget {
  return {
    marketplace: 'ym',
    marketplaceLabel: 'Яндекс Маркет',
    key: 'c1',
    name: 'Магазин',
    placement: 'FBS',
    blockedBy: null,
    blockedText: null,
    error: null,
    updates: [ROW],
    zeroed: 0,
    unchanged: 0,
    notListed: 0,
    notWritable: 0,
    willWrite: true,
    ...over,
  };
}

function planOf(hash: string, targets: StockPushTarget[]): StockPushPlan {
  return { planHash: hash, targets } as StockPushPlan;
}

describe('usePushSelection', () => {
  it('по умолчанию отмечены все площадки, куда можно писать; закрытую не отметить', () => {
    const plan = ref<StockPushPlan | null>(
      planOf('h1', [
        target({}),
        target({ marketplace: 'ozon', key: 'ozon:1', updates: [ROW, ROW] }),
        target({ marketplace: 'wb', key: 'wb', willWrite: false }),
      ]),
    );
    const selection = usePushSelection(plan);

    expect(selection.marketplaces.value).toEqual(['ym', 'ozon']);
    expect(selection.count.value).toBe(3);

    selection.toggle('wb', true);
    expect(selection.isSelected('wb')).toBe(false);

    selection.toggle('ym', false);
    expect(selection.marketplaces.value).toEqual(['ozon']);
    expect(selection.count.value).toBe(2);
  });

  it('новый план снова отмечает все — выбор относился к прошлым числам', async () => {
    const plan = ref<StockPushPlan | null>(planOf('h1', [target({})]));
    const selection = usePushSelection(plan);
    selection.toggle('ym', false);
    expect(selection.marketplaces.value).toEqual([]);

    plan.value = planOf('h2', [target({})]);
    await nextTick();
    expect(selection.marketplaces.value).toEqual(['ym']);
  });

  it('без плана — ничего не выбрано', () => {
    const selection = usePushSelection(ref(null));
    expect(selection.options.value).toEqual([]);
    expect(selection.count.value).toBe(0);
  });
});
