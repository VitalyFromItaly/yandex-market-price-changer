import type { NotificationSettingsResponse } from '../notifications.domain';

import { describe, expect, it } from 'vitest';

import {
  mapFeed,
  mapSettings,
  mapSettingsError,
  rulesDiff,
  toRulesForm,
} from './mapNotifications.notifications';

import { ApiError } from '@/shared/http';

const SETTINGS: NotificationSettingsResponse = {
  telegramAvailable: true,
  telegram: true,
  time: '09:00',
  rules: [
    {
      key: 'low_stock',
      label: 'Мало остатка',
      description: '',
      unit: 'units',
      enabled: true,
      threshold: 5,
      min: 1,
      max: 1000,
    },
    {
      key: 'tax_limit',
      label: 'Налог',
      description: '',
      unit: null,
      enabled: true,
      threshold: null,
      min: null,
      max: null,
    },
  ],
};

describe('mapNotifications', () => {
  it('лента: дата по Москве, отметка Telegram', () => {
    const feed = mapFeed(
      {
        items: [
          {
            id: '1',
            rule: 'low_stock',
            ruleLabel: 'Мало остатка',
            marketplace: null,
            marketplaceLabel: null,
            title: 'T',
            body: 'B',
            active: true,
            read: false,
            createdAt: '2026-10-17T06:00:00Z',
            sentAt: null,
          },
        ],
        total: 1,
        unread: 1,
      },
      new Date('2026-10-18T06:00:00Z'),
    );
    expect(feed.items[0]).toMatchObject({
      createdLabel: '17-10-2026 09:00',
      sentToTelegram: false,
    });
  });

  it('единица порога — подписью; правило без порога — пустое поле', () => {
    const settings = mapSettings(SETTINGS);
    expect(settings.rules.map((rule) => rule.unitLabel)).toEqual(['шт.', null]);
    expect(toRulesForm(settings)).toEqual({
      low_stock: { enabled: true, threshold: '5' },
      tax_limit: { enabled: true, threshold: '' },
    });
  });

  it('на сервер — только изменённое; порог числом, мусор — как есть (проверит сервер)', () => {
    const settings = mapSettings(SETTINGS);
    const form = toRulesForm(settings);
    expect(rulesDiff(settings, form)).toEqual({});

    form.low_stock = { enabled: true, threshold: ' 3 ' };
    form.tax_limit = { enabled: false, threshold: '' };
    expect(rulesDiff(settings, form)).toEqual({
      rules: { low_stock: { threshold: 3 }, tax_limit: { enabled: false } },
    });

    form.low_stock = { enabled: true, threshold: 'пять' };
    expect(rulesDiff(settings, form).rules?.low_stock).toEqual({ threshold: 'пять' });
  });

  it('ошибка сервера встаёт под своё поле', () => {
    const error = new ApiError(
      'Порог — от 1 до 1000',
      400,
      'INVALID_SETTING',
      'rules.low_stock.threshold',
    );
    expect(mapSettingsError(error, 'x')).toEqual({
      'rules.low_stock.threshold': 'Порог — от 1 до 1000',
    });
    expect(mapSettingsError(new Error('сеть'), 'x')).toEqual({ form: 'сеть' });
  });
});
