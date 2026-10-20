import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMarketplacesStore } from '../store/store.marketplaces';

import { useOzonConnectForm } from './useOzonConnectForm.marketplaces';

import { ApiError } from '@/shared/http';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast }));

describe('useOzonConnectForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    for (const fn of Object.values(toast)) fn.mockReset();
  });

  it('успех — поля очищаются, тост «Ozon подключён»', async () => {
    const store = useMarketplacesStore();
    vi.spyOn(store, 'connectOzon').mockResolvedValue(undefined);
    const form = useOzonConnectForm();
    form.clientId.value = ' 1234567 ';
    form.apiKey.value = ' key-0123456789abcdef ';

    await form.submit();

    expect(store.connectOzon).toHaveBeenCalledWith({
      clientId: '1234567',
      apiKey: 'key-0123456789abcdef',
    });
    expect(form.clientId.value).toBe('');
    expect(form.apiKey.value).toBe('');
    expect(toast.success).toHaveBeenCalledWith(
      'Ozon подключён',
      'Ключ проверен в Ozon и сохранён.',
    );
  });

  it('отказ по ключу — текст под полем, которое назвал сервер; ввод остаётся', async () => {
    const store = useMarketplacesStore();
    const form = useOzonConnectForm();
    form.clientId.value = 'abc';
    form.apiKey.value = 'key-0123456789abcdef';

    vi.spyOn(store, 'connectOzon').mockRejectedValueOnce(
      new ApiError('Client-Id — это число', 400, 'INVALID_OZON_KEY', 'clientId'),
    );
    await form.submit();
    expect(form.errors.value).toEqual({ clientId: 'Client-Id — это число', apiKey: null });
    expect(form.clientId.value).toBe('abc');

    vi.mocked(store.connectOzon).mockRejectedValueOnce(
      new ApiError('Ozon не принял ключ.', 400, 'OZON_KEY_REJECTED', 'apiKey'),
    );
    await form.submit();
    expect(form.errors.value).toEqual({ clientId: null, apiKey: 'Ozon не принял ключ.' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('Ozon недоступен — тост, поля без ошибок', async () => {
    const store = useMarketplacesStore();
    vi.spyOn(store, 'connectOzon').mockRejectedValue(
      new ApiError('Ozon сейчас не отвечает', 503, 'OZON_UNAVAILABLE'),
    );
    const form = useOzonConnectForm();
    form.clientId.value = '1234567';
    form.apiKey.value = 'key-0123456789abcdef';

    await form.submit();

    expect(form.errors.value).toEqual({ clientId: null, apiKey: null });
    expect(toast.error).toHaveBeenCalledWith('Ключ не сохранён', 'Ozon сейчас не отвечает');
  });
});
