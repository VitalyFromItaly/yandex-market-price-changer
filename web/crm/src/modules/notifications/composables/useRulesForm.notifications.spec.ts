import type { NotificationSettings, RulesForm } from '../notifications.domain';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';

import { useNotificationsStore } from '../store/store.notifications';

import { useRulesForm } from './useRulesForm.notifications';

import { ApiError } from '@/shared/http';

const api = vi.hoisted(() => ({
  feed: vi.fn(),
  markRead: vi.fn(),
  checkNow: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
}));
vi.mock('../api/notificationsApi.notifications', () => ({ notificationsApi: api }));

const SETTINGS: NotificationSettings = {
  telegramAvailable: false,
  telegram: true,
  time: '09:00',
  rules: [
    {
      key: 'low_stock',
      label: 'Мало остатка',
      description: '',
      unit: 'units',
      unitLabel: 'шт.',
      enabled: true,
      threshold: 5,
      min: 1,
      max: 1000,
    },
  ],
};

beforeEach(async () => {
  for (const fn of Object.values(api)) fn.mockReset();
  const pinia = createPinia();
  createApp({}).use(pinia);
  setActivePinia(pinia);
  api.settings.mockResolvedValueOnce(SETTINGS);
  await useNotificationsStore().loadSettings();
});

function filled(form: { value: RulesForm | null }): RulesForm {
  if (form.value === null) throw new Error('форма не загружена');
  return form.value;
}

describe('useRulesForm', () => {
  it('без правок сохранять нечего; после правки уходит только изменённое', async () => {
    const { form, dirty, submit } = useRulesForm();
    expect(dirty.value).toBe(false);
    filled(form).low_stock = { enabled: true, threshold: '3' };
    expect(dirty.value).toBe(true);
    api.saveSettings.mockResolvedValueOnce({
      ...SETTINGS,
      rules: [{ ...SETTINGS.rules[0], threshold: 3 }],
    });
    await submit();
    expect(api.saveSettings).toHaveBeenCalledWith({ rules: { low_stock: { threshold: 3 } } });
    expect(filled(form).low_stock?.threshold).toBe('3');
  });

  it('отказ сервера — под поле правила, форма не сбрасывается', async () => {
    const { form, errors, submit } = useRulesForm();
    filled(form).low_stock = { enabled: true, threshold: '0' };
    api.saveSettings.mockRejectedValueOnce(
      new ApiError('Порог — от 1 до 1000', 400, 'INVALID_SETTING', 'rules.low_stock.threshold'),
    );
    await submit();
    expect(errors.value).toEqual({ 'rules.low_stock.threshold': 'Порог — от 1 до 1000' });
    expect(filled(form).low_stock?.threshold).toBe('0');
  });
});
