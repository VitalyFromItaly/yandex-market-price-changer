import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useProductsStore } from './store.products';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  card: vi.fn(),
  updatePurchase: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  unmatched: vi.fn(),
}));
vi.mock('../api/productsApi.products', () => ({ productsApi: api }));

const PAGE = { total: 1, totalAll: 1, page: 1, pages: 1, brands: [], items: [] };
const card = (id: string, price = 1000) => ({
  id,
  internalSku: id,
  purchase: { price, currency: 'RUR', rate: null, extraCosts: null },
  cost: price,
  history: [],
  links: [],
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Товары»', () => {
  it('поиск и бренд начинают с первой страницы; опоздавший ответ выбрасывается', async () => {
    const store = useProductsStore();
    api.list.mockResolvedValue(PAGE);
    await store.goToListPage(3);
    await store.filterBrand('casio');
    expect(api.list).toHaveBeenLastCalledWith({ q: '', brand: 'casio', page: 1 });

    let late: (value: unknown) => void = () => undefined;
    api.list.mockReturnValueOnce(new Promise((resolve) => (late = resolve)));
    const first = store.search('старое');
    api.list.mockResolvedValueOnce({ ...PAGE, total: 7 });
    await store.search('новое');
    late({ ...PAGE, total: 999 });
    await first;
    expect(store.listPage?.total).toBe(7);
  });

  it('ошибка списка — текстом, без страницы', async () => {
    const store = useProductsStore();
    api.list.mockRejectedValueOnce(new Error('сеть'));
    await store.loadList();
    expect(store.listPage).toBeNull();
    expect(store.listError).toBe('сеть');
  });

  it('карточка: чужая не мелькает под новым id; правка заменяет карточку ответом', async () => {
    const store = useProductsStore();
    api.card.mockResolvedValueOnce(card('a'));
    await store.loadCard('a');
    expect(store.card?.id).toBe('a');

    let pending: (value: unknown) => void = () => undefined;
    api.card.mockReturnValueOnce(new Promise((resolve) => (pending = resolve)));
    const loading = store.loadCard('b');
    expect(store.card).toBeNull();
    pending(card('b'));
    await loading;

    api.updatePurchase.mockResolvedValueOnce(card('b', 1200));
    await store.savePurchase('b', { price: '1200', currency: 'RUR', rate: null, extraCosts: null });
    expect(store.card?.cost).toBe(1200);

    api.updatePurchase.mockRejectedValueOnce(new Error('400'));
    await expect(
      store.savePurchase('b', { price: '0', currency: 'RUR', rate: null, extraCosts: null }),
    ).rejects.toThrow('400');
    expect(store.card?.cost).toBe(1200);
  });

  it('привязка из очереди перечитывает очередь; reset чистит всё', async () => {
    const store = useProductsStore();
    api.unmatched.mockResolvedValue({ total: 0, page: 1, pages: 1, items: [] });
    api.link.mockResolvedValueOnce(card('a'));
    await store.linkUnmatched('a', { marketplace: 'ozon', sku: 'OZ-1' });
    expect(api.link).toHaveBeenCalledWith('a', { marketplace: 'ozon', sku: 'OZ-1' });
    expect(api.unmatched).toHaveBeenCalledWith(1);
    expect(store.unmatchedPage?.total).toBe(0);

    resetAllStores();
    expect(store.unmatchedPage).toBeNull();
    expect(store.listQuery).toEqual({ q: '', brand: '', page: 1 });
  });
});
