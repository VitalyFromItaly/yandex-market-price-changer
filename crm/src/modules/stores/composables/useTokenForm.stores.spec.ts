import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStoresStore } from '../store/store.stores';

import { useTokenForm } from './useTokenForm.stores';

import { ApiError } from '@/shared/http';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast }));

describe('useTokenForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    for (const fn of Object.values(toast)) fn.mockReset();
  });

  it('успех — поле очищается, тост «Токен сохранён»', async () => {
    const store = useStoresStore();
    vi.spyOn(store, 'replaceToken').mockResolvedValue({ stores: [], botStore: null });
    const form = useTokenForm();
    form.token.value = '  ACMA:new-token  ';

    await form.submit();

    expect(store.replaceToken).toHaveBeenCalledWith('ACMA:new-token');
    expect(form.token.value).toBe('');
    expect(form.error.value).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Токен сохранён', 'Список магазинов обновлён.');
  });

  it('отказ по токену — текст сервера под полем, токен в поле остаётся', async () => {
    const store = useStoresStore();
    vi.spyOn(store, 'replaceToken').mockRejectedValue(
      new ApiError('Яндекс.Маркет отклонил ваш API-токен.', 400, 'TOKEN_REJECTED'),
    );
    const form = useTokenForm();
    form.token.value = 'ACMA:bad-token';

    await form.submit();

    expect(form.error.value).toBe('Яндекс.Маркет отклонил ваш API-токен.');
    expect(form.token.value).toBe('ACMA:bad-token');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('Маркет недоступен — тостом, а не под полем: токен тут ни при чём', async () => {
    const store = useStoresStore();
    vi.spyOn(store, 'replaceToken').mockRejectedValue(
      new ApiError('Яндекс.Маркет не отвечает', 503, 'MARKET_UNAVAILABLE'),
    );
    const form = useTokenForm();
    form.token.value = 'ACMA:new-token';

    await form.submit();

    expect(form.error.value).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Токен не сохранён', 'Яндекс.Маркет не отвечает');
    expect(form.busy.value).toBe(false);
  });
});
