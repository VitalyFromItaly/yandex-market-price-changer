import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { usePriceCalculatorStore } from './store.price-calculator';

import { resettableStoresPlugin } from '@/shared/store';

const jobs = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('@/shared/jobs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  jobsApi: { start: jobs.start, get: vi.fn(), file: vi.fn() },
}));

beforeEach(() => {
  jobs.start.mockReset();
  jobs.start.mockResolvedValue({ jobId: 'j', created: true });
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Калькулятора цен»', () => {
  it('ставки — задача аккаунта без параметров, повторный вход её не ставит', () => {
    const store = usePriceCalculatorStore();
    store.ensure();
    store.ensure();
    expect(jobs.start).toHaveBeenCalledTimes(1);
    expect(jobs.start).toHaveBeenCalledWith('price-calc:rates', {}, '');
  });

  it('тариф — задача магазина с артикулом и ценой', () => {
    const store = usePriceCalculatorStore();
    store.setTariffStore('k1');
    store.setSku('A1');
    store.setPriceText('3000');
    store.checkTariff();
    expect(jobs.start).toHaveBeenCalledWith(
      'price-calc:tariff',
      { sku: 'A1', priceKopecks: 300_000 },
      'k1',
    );
  });

  it('без товара или цены тариф не спрашивается', () => {
    const store = usePriceCalculatorStore();
    store.setTariffStore('k1');
    store.checkTariff();
    expect(jobs.start).not.toHaveBeenCalled();
  });

  it('правка ставки, «вернуть» и reset', async () => {
    const store = usePriceCalculatorStore();
    store.setOverride('commission', '18');
    expect(store.overrides.commission).toBeCloseTo(0.18, 12);
    store.clearOverride('commission');
    expect(store.overrides.commission).toBeUndefined();

    store.setOverride('cogs', '1000');
    store.setMode('price');
    store.reset();
    expect(store.overrides).toEqual({});
    expect(store.mode).toBe('profit');
    expect(store.sku).toBeNull();
  });

  it('другой товар сбрасывает правки прежнего', async () => {
    const store = usePriceCalculatorStore();
    store.setOverride('cogs', '1000');
    store.setSku('B2');
    await Promise.resolve();
    expect(store.overrides).toEqual({});
  });
});
