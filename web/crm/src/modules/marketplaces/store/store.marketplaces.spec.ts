import type { ConnectionCard, MarketplaceConnection } from '../marketplaces.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useMarketplacesStore } from './store.marketplaces';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  connectOzon: vi.fn(),
  replaceYmToken: vi.fn(),
  cards: vi.fn(),
  check: vi.fn(),
}));
vi.mock('../api/marketplacesApi.marketplaces', () => ({ marketplacesApi: api }));

const YM = {
  key: 'ym' as const,
  label: 'Яндекс Маркет',
  connected: true,
  status: 'ok' as const,
  accountCount: 2,
  available: true,
};

function card(base: MarketplaceConnection): ConnectionCard {
  return { ...base, keyHint: '••••1234', checkedAt: null, checkError: null, accounts: [] };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('стор «Площадки»', () => {
  it('грузит один раз; до ответа площадка неизвестна, а не «не подключена»', async () => {
    const store = useMarketplacesStore();
    expect(store.connectionOf('ym')).toBeNull();

    api.list.mockResolvedValue([YM]);
    await store.ensure();
    await store.ensure();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(store.connectionOf('ym')?.connected).toBe(true);
    expect(store.connectionOf('ozon')).toBeNull();
  });

  it('ошибка — текстом и повтор при следующем показе', async () => {
    const store = useMarketplacesStore();
    api.list.mockRejectedValueOnce(new Error('сеть'));
    await store.ensure();
    expect(store.error).toBe('сеть');

    api.list.mockResolvedValueOnce([YM]);
    await store.ensure();
    expect(store.error).toBeNull();
    expect(store.connections).toEqual([YM]);
  });

  it('подключение Ozon перечитывает карточки и список площадок для сайдбара', async () => {
    const store = useMarketplacesStore();
    const ozonOk = { ...YM, key: 'ozon' as const, label: 'Ozon', accountCount: 1 };
    api.list.mockResolvedValueOnce([YM]);
    await store.ensure();

    api.connectOzon.mockResolvedValueOnce(ozonOk);
    api.list.mockResolvedValueOnce([YM, ozonOk]);
    api.cards.mockResolvedValueOnce([card(YM), card(ozonOk)]);
    await store.connectOzon({ clientId: '123', apiKey: 'key' });

    expect(api.connectOzon).toHaveBeenCalledWith({ clientId: '123', apiKey: 'key' });
    expect(store.connections).toEqual([YM, ozonOk]);
    expect(store.cards.map((c) => c.key)).toEqual(['ym', 'ozon']);
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('отказ при замене ключа пробрасывается, карточки и список не трогаются', async () => {
    const store = useMarketplacesStore();
    api.cards.mockResolvedValueOnce([card(YM)]);
    await store.loadCards();
    api.replaceYmToken.mockRejectedValueOnce(new Error('отклонил'));
    await expect(store.replaceYmToken('ACMA:bad')).rejects.toThrow('отклонил');
    expect(api.cards).toHaveBeenCalledTimes(1);
    expect(api.list).not.toHaveBeenCalled();
  });

  it('проверка связи: карточка — из ответа, «Проверяю» снимается и при сбое сети', async () => {
    const store = useMarketplacesStore();
    api.cards.mockResolvedValueOnce([card(YM)]);
    await store.loadCards();

    const rejected = { ...card(YM), status: 'rejected' as const, checkError: 'отклонил' };
    api.check.mockResolvedValueOnce({
      connection: rejected,
      check: { status: 'rejected', message: 'отклонил' },
    });
    api.list.mockResolvedValueOnce([YM]);
    expect(await store.checkConnection('ym')).toEqual({ status: 'rejected', message: 'отклонил' });
    expect(store.cards[0]?.checkError).toBe('отклонил');
    expect(store.checking).toBeNull();

    api.check.mockRejectedValueOnce(new Error('сеть'));
    await expect(store.checkConnection('ym')).rejects.toThrow('сеть');
    expect(store.checking).toBeNull();
  });

  it('выход чистит стор — следующий продавец не увидит чужие площадки', async () => {
    const store = useMarketplacesStore();
    api.list.mockResolvedValueOnce([YM]);
    await store.ensure();
    resetAllStores();
    expect(store.connections).toEqual([]);
  });
});
