import { afterEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY, readPreference, resolveTheme } from './useTheme';

const storageWith = (value: string | null): Pick<Storage, 'getItem'> => ({
  getItem: (key) => (key === THEME_STORAGE_KEY ? value : null),
});

describe('useTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('«как в системе» следует ОС, явный выбор — нет', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('по умолчанию — «как в системе»', () => {
    vi.stubGlobal('localStorage', storageWith(null));
    expect(readPreference()).toBe('system');
  });

  it('сохранённый выбор читается, мусор — нет', () => {
    vi.stubGlobal('localStorage', storageWith('dark'));
    expect(readPreference()).toBe('dark');
    vi.stubGlobal('localStorage', storageWith('purple'));
    expect(readPreference()).toBe('system');
  });

  it('запрещённое хранилище не роняет — остаётся «как в системе»', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(readPreference()).toBe('system');
  });
});
