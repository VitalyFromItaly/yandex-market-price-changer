import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import { useAccountingOrdersFilters } from './useAccountingOrdersFilters.accounting';

const STORES = [
  { key: 'a', label: 'Магазин А' },
  { key: 'b', label: 'Магазин Б' },
];

describe('useAccountingOrdersFilters', () => {
  it('месяц — текущий включительно, магазин — первый, пустые фильтры — null', () => {
    const f = useAccountingOrdersFilters(() => STORES, '2026-11-09');
    expect(f.month.value).toBe('2026-11');
    expect(f.monthOptions).toHaveLength(13);
    expect(f.monthTitle.value).toBe('Ноябрь 2026');
    expect(f.request.value).toEqual({
      store: 'a',
      month: '2026-11',
      marketplace: null,
      state: null,
      lossOnly: false,
    });
    expect(f.filtered.value).toBe(false);
  });

  it('выбор магазина и фильтра попадает в запрос; сброс — обратно', () => {
    const f = useAccountingOrdersFilters(() => STORES, '2026-11-09');
    f.selectStore('b');
    f.state.value = 'preliminary';
    f.lossOnly.value = true;
    expect(f.request.value).toMatchObject({ store: 'b', state: 'preliminary', lossOnly: true });
    expect(f.filtered.value).toBe(true);
    f.resetFilter();
    expect(f.request.value).toMatchObject({ state: null, lossOnly: false });
  });

  it('нет магазинов — запроса нет; пропавший магазин — снова первый', () => {
    const list = ref(STORES);
    const f = useAccountingOrdersFilters(() => list.value, '2026-11-09');
    f.selectStore('b');
    list.value = STORES.slice(0, 1);
    expect(f.store.value?.key).toBe('a');
    list.value = [];
    expect(f.request.value).toBeNull();
  });
});
