import type { ProfileResponse } from '../profile.domain';

import { describe, expect, it } from 'vitest';

import { mapProfile } from './mapProfile.profile';

function response(overrides: Partial<ProfileResponse> = {}): ProfileResponse {
  return {
    telegramUserId: '222',
    name: 'Вася Пупкин',
    username: 'vasya',
    isAdmin: false,
    access: { status: 'approved', label: '✅ Выдан' },
    registeredAt: '2026-07-28T10:00:00.000Z',
    store: { name: 'Время с SBrand', placementType: 'FBS', configured: true },
    priceListUpdatedAt: '2026-09-20T22:30:00.000Z',
    features: [{ key: 'report_redeemed', label: '✅ Выкуплено' }],
    ...overrides,
  };
}

const valueOf = (facts: { label: string; value: string }[], label: string) =>
  facts.find((row) => row.label === label)?.value;

describe('mapProfile', () => {
  it('поля профиля и даты по Москве', () => {
    const { facts, features } = mapProfile(response());
    expect(valueOf(facts, 'Пользователь')).toBe('Вася Пупкин');
    expect(valueOf(facts, 'Telegram')).toBe('@vasya');
    expect(valueOf(facts, 'Доступ')).toBe('✅ Выдан');
    expect(valueOf(facts, 'Магазин')).toBe('Время с SBrand');
    expect(valueOf(facts, 'Модель работы')).toBe('FBS');
    expect(valueOf(facts, 'Регистрация')).toBe('28-07-2026');
    // 22:30 UTC — уже следующий день по Москве.
    expect(valueOf(facts, 'Прайс загружен')).toBe('21-09-2026');
    expect(features).toHaveLength(1);
  });

  it('пустое — заглушкой, а не пустой строкой', () => {
    const { facts } = mapProfile(
      response({
        name: null,
        username: null,
        store: { name: null, placementType: null, configured: true },
        priceListUpdatedAt: null,
      }),
    );
    expect(facts.find((row) => row.label === 'Пользователь')).toMatchObject({
      value: '—',
      muted: true,
    });
    expect(valueOf(facts, 'Telegram')).toBe('ник не указан');
    expect(valueOf(facts, 'Магазин')).toBe('подключён');
    expect(valueOf(facts, 'Модель работы')).toBe('неизвестна');
    expect(valueOf(facts, 'Прайс загружен')).toBe('ещё не загружали');
  });

  it('без даты регистрации строки нет — как в боте', () => {
    const { facts } = mapProfile(response({ registeredAt: null }));
    expect(facts.some((row) => row.label === 'Регистрация')).toBe(false);
  });

  it('в карточке нет идентификаторов магазина', () => {
    expect(JSON.stringify(mapProfile(response()))).not.toMatch(/campaign|business|token/i);
  });
});
