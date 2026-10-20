import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCollapsed, useSidebarCollapsed } from './useSidebarCollapsed';

describe('useSidebarCollapsed', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('по умолчанию развёрнут; переключение запоминается', () => {
    const { collapsed, toggle } = useSidebarCollapsed();
    expect(collapsed.value).toBe(false);
    toggle();
    expect(collapsed.value).toBe(true);
    expect(readCollapsed()).toBe(true);
    expect(useSidebarCollapsed().collapsed.value).toBe(true);
    toggle();
    expect(readCollapsed()).toBe(false);
  });

  it('нет хранилища — развёрнут, без падения', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    });
    const { collapsed, toggle } = useSidebarCollapsed();
    expect(collapsed.value).toBe(false);
    expect(() => toggle()).not.toThrow();
  });
});
