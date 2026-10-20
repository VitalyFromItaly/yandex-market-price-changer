import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useNotificationsStore } from './store.notifications';

import { resetAllStores, resettableStoresPlugin } from '@/shared/store';

const api = vi.hoisted(() => ({
  feed: vi.fn(),
  markRead: vi.fn(),
  checkNow: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
}));
vi.mock('../api/notificationsApi.notifications', () => ({ notificationsApi: api }));

const FEED = { items: [], total: 0, unread: 0 };
const SETTINGS = { telegramAvailable: false, telegram: true, time: '09:00', rules: [] };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia().use(resettableStoresPlugin);
  createApp({}).use(pinia);
  setActivePinia(pinia);
});

describe('useNotificationsStore', () => {
  it('фильтр «непрочитанные» перечитывает ленту с ним', async () => {
    api.feed.mockResolvedValue(FEED);
    const store = useNotificationsStore();
    await store.load();
    await store.setUnreadOnly(true);
    expect(api.feed.mock.calls.map((call) => call[0])).toEqual([false, true]);
    expect(store.unreadOnly).toBe(true);
  });

  it('отметка прочитанного перечитывает ленту — на экране записанное', async () => {
    api.feed.mockResolvedValue(FEED);
    api.markRead.mockResolvedValue({ updated: 1 });
    const store = useNotificationsStore();
    await store.markRead('all');
    expect(api.markRead).toHaveBeenCalledWith('all');
    expect(api.feed).toHaveBeenCalledTimes(1);
  });

  it('ошибка загрузки — текстом, а не исключением; ошибка записи настроек — наружу', async () => {
    api.feed.mockRejectedValue(new Error('Сервер недоступен'));
    api.saveSettings.mockRejectedValue(new Error('плохо'));
    const store = useNotificationsStore();
    await store.load();
    expect(store.error).toBe('Сервер недоступен');
    await expect(store.saveSettings({ time: '25:00' })).rejects.toThrow('плохо');
  });

  it('reset чистит ленту, фильтр и настройки', async () => {
    api.feed.mockResolvedValue(FEED);
    api.settings.mockResolvedValue(SETTINGS);
    const store = useNotificationsStore();
    await store.setUnreadOnly(true);
    await store.loadSettings();
    resetAllStores();
    expect(store.feed).toBeNull();
    expect(store.settings).toBeNull();
    expect(store.unreadOnly).toBe(false);
  });
});
