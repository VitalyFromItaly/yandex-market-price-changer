import type { QuarantineView } from '../quarantine.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useQuarantineStore } from './store.quarantine';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({ list: vi.fn(), confirm: vi.fn() }));
vi.mock('../api/quarantineApi.quarantine', () => ({ quarantineApi: api }));

const view = (ids: string[]): QuarantineView => ({
  explainer: ['e'],
  note: 'n',
  rows: ids.map((offerId) => ({
    offerId,
    reasons: ['r'],
    currentPrice: 1,
    lastValidPrice: null,
    minPrice: null,
  })),
});

describe('store.quarantine', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.list.mockReset();
    api.confirm.mockReset();
  });

  it('загрузка по ключу магазина; ошибка — текстом сервера', async () => {
    const store = useQuarantineStore();
    api.list.mockResolvedValueOnce(view(['A']));
    await store.load('k1');
    expect(api.list).toHaveBeenCalledWith('k1');
    expect(store.view?.rows).toHaveLength(1);

    api.list.mockRejectedValueOnce(new ApiError('Маркет не отвечает', 502, 'MARKET_ERROR'));
    await store.load('k1');
    expect(store.loadError).toBe('Маркет не отвечает');
  });

  it('подтверждение перезагружает список и при успехе, и при частичном сбое', async () => {
    const store = useQuarantineStore();
    api.confirm.mockResolvedValueOnce({ confirmed: 1, stale: 0 });
    api.list.mockResolvedValue(view([]));

    expect(await store.confirm('k1', ['A'])).toEqual({ confirmed: 1, stale: 0 });
    expect(api.confirm).toHaveBeenCalledWith('k1', ['A']);
    expect(api.list).toHaveBeenCalledTimes(1);

    api.confirm.mockRejectedValueOnce(
      new ApiError('Подтверждено 200 из 300', 502, 'QUARANTINE_PARTIAL'),
    );
    expect(await store.confirm('k1', ['A', 'B'])).toBeNull();
    expect(store.confirmError).toBe('Подтверждено 200 из 300');
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(store.isConfirming).toBe(false);
  });

  it('reset чистит список и ошибки', async () => {
    const store = useQuarantineStore();
    api.list.mockResolvedValueOnce(view(['A']));
    await store.load('k1');
    api.confirm.mockRejectedValueOnce(new Error('x'));
    api.list.mockResolvedValueOnce(view(['A']));
    await store.confirm('k1', ['A']);

    store.reset();
    expect(store.view).toBeNull();
    expect(store.loadError).toBeNull();
    expect(store.confirmError).toBeNull();
  });
});
