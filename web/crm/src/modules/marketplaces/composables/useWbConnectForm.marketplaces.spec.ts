import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMarketplacesStore } from '../store/store.marketplaces';

import { useWbConnectForm } from './useWbConnectForm.marketplaces';

import { ApiError } from '@/shared/http';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ toast }));

describe('useWbConnectForm', () => {
  const onDone = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    onDone.mockReset();
    for (const fn of Object.values(toast)) fn.mockReset();
  });

  it('успех — поле очищается, форма сворачивается', async () => {
    const store = useMarketplacesStore();
    vi.spyOn(store, 'connectWb').mockResolvedValue(undefined);
    const form = useWbConnectForm(onDone);
    form.token.value = ' a.b.c ';

    await form.submit();

    expect(store.connectWb).toHaveBeenCalledWith('a.b.c');
    expect(form.token.value).toBe('');
    expect(onDone).toHaveBeenCalled();
  });

  it('нет категорий — перечень под полем, токен в поле остаётся', async () => {
    const store = useMarketplacesStore();
    vi.spyOn(store, 'connectWb').mockRejectedValue(
      new ApiError('У токена нет доступа к категориям: «Финансы».', 400, 'WB_TOKEN_SCOPES'),
    );
    const form = useWbConnectForm(onDone);
    form.token.value = 'a.b.c';

    await form.submit();

    expect(form.error.value).toContain('«Финансы»');
    expect(form.token.value).toBe('a.b.c');
    expect(toast.error).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('WB недоступен — тостом, а не под полем', async () => {
    const store = useMarketplacesStore();
    vi.spyOn(store, 'connectWb').mockRejectedValue(
      new ApiError('Wildberries сейчас не отвечает', 503, 'WB_UNAVAILABLE'),
    );
    const form = useWbConnectForm(onDone);
    form.token.value = 'a.b.c';

    await form.submit();

    expect(form.error.value).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Токен не сохранён', 'Wildberries сейчас не отвечает');
  });
});
