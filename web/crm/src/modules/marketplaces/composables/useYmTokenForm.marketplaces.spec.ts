import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMarketplacesStore } from '../store/store.marketplaces';

import { useYmTokenForm } from './useYmTokenForm.marketplaces';

import { ApiError } from '@/shared/http';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast }));

describe('useYmTokenForm', () => {
  const onDone = vi.fn();

  beforeEach(() => {
    onDone.mockReset();
    setActivePinia(createPinia());
    for (const fn of Object.values(toast)) fn.mockReset();
  });

  it('успех — поле очищается, тост «Токен сохранён»', async () => {
    const store = useMarketplacesStore();
    vi.spyOn(store, 'replaceYmToken').mockResolvedValue({ storeCount: 1, botStore: null });
    const form = useYmTokenForm(onDone);
    form.token.value = '  ACMA:new-token  ';

    await form.submit();

    expect(store.replaceYmToken).toHaveBeenCalledWith('ACMA:new-token');
    expect(form.token.value).toBe('');
    expect(form.error.value).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Токен сохранён', 'Список магазинов обновлён.');
    expect(onDone).toHaveBeenCalled();
  });

  it('отказ по токену — текст сервера под полем, токен в поле остаётся', async () => {
    const store = useMarketplacesStore();
    vi.spyOn(store, 'replaceYmToken').mockRejectedValue(
      new ApiError('Яндекс.Маркет отклонил ваш API-токен.', 400, 'TOKEN_REJECTED'),
    );
    const form = useYmTokenForm(onDone);
    form.token.value = 'ACMA:bad-token';

    await form.submit();

    expect(form.error.value).toBe('Яндекс.Маркет отклонил ваш API-токен.');
    expect(form.token.value).toBe('ACMA:bad-token');
    expect(toast.error).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Маркет недоступен — тостом, а не под полем: токен тут ни при чём', async () => {
    const store = useMarketplacesStore();
    vi.spyOn(store, 'replaceYmToken').mockRejectedValue(
      new ApiError('Яндекс.Маркет не отвечает', 503, 'MARKET_UNAVAILABLE'),
    );
    const form = useYmTokenForm(onDone);
    form.token.value = 'ACMA:new-token';

    await form.submit();

    expect(form.error.value).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Токен не сохранён', 'Яндекс.Маркет не отвечает');
    expect(form.busy.value).toBe(false);
  });
});
