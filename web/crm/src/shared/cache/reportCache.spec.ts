import { describe, expect, it } from 'vitest';

import {
  CACHE_PREFIX,
  INDEX_KEY,
  MAX_ENTRIES,
  MAX_ENTRY_CHARS,
  TTL_MS,
  cacheKey,
  clearStoredCache,
  isFresh,
  persistEntry,
  stableStringify,
  touchIndex,
} from './reportCache';

/** Map-хранилище; `quotaAfter` — сколько записей влезает, дальше QuotaExceededError. */
function memoryStorage(quotaAfter = Infinity): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (
        !map.has(k) &&
        k !== INDEX_KEY &&
        [...map.keys()].filter((x) => x !== INDEX_KEY).length >= quotaAfter
      ) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe('reportCache', () => {
  it('ключ не зависит от порядка params и несёт аккаунт, kind и магазин', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3] } })).toBe('{"a":{"c":[3],"d":2},"b":1}');
    const a = cacheKey('u1', {
      kind: 'orders:redeemed',
      store: 's1',
      params: { period: 'month', day: undefined },
    });
    const b = cacheKey('u1', { kind: 'orders:redeemed', store: 's1', params: { period: 'month' } });
    expect(a).toBe(b);
    expect(a).toBe(`${CACHE_PREFIX}u1:orders:redeemed:s1:{"period":"month"}`);
    expect(cacheKey('u2', { kind: 'orders:redeemed', store: 's1' })).not.toBe(a);
  });

  it('без владельца ключа нет — чужие данные без хозяина не показываются', () => {
    expect(cacheKey(null, { kind: 'k', store: 's' })).toBeNull();
    expect(cacheKey('', { kind: 'k', store: 's' })).toBeNull();
  });

  it('запись старше недели и битая дата — не свежие', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    expect(isFresh({ savedAt: '2026-09-24T12:00:00Z', data: 1 }, now)).toBe(true);
    expect(isFresh({ savedAt: new Date(now - TTL_MS - 1).toISOString(), data: 1 }, now)).toBe(
      false,
    );
    expect(isFresh({ savedAt: 'вчера', data: 1 }, now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
  });

  it('индекс держит не больше лимита, вытесняет самые старые и протухшие', () => {
    const now = 10 * TTL_MS;
    const index = Array.from(
      { length: MAX_ENTRIES },
      (_, i) => [`k${i}`, now - i] as [string, number],
    );
    index.push(['old', now - TTL_MS - 1]);
    const { index: next, evicted } = touchIndex(index, 'new', now);
    expect(next).toHaveLength(MAX_ENTRIES);
    expect(next.at(-1)?.[0]).toBe('new');
    expect(evicted).toContain('old');
    expect(evicted).toContain(`k${MAX_ENTRIES - 1}`);
  });

  it('большая запись в хранилище не пишется, прежняя по этому ключу стирается', () => {
    const storage = memoryStorage();
    storage.setItem('k', 'old');
    expect(persistEntry(storage, 'k', 'x'.repeat(MAX_ENTRY_CHARS + 1), 1)).toBe(false);
    expect(storage.getItem('k')).toBeNull();
  });

  it('кончилась квота — выбрасывается старшая половина, запись повторяется', () => {
    const storage = memoryStorage(4);
    for (let i = 0; i < 4; i += 1) expect(persistEntry(storage, `k${i}`, 'v', i)).toBe(true);
    expect(persistEntry(storage, 'k4', 'v', 10)).toBe(true);
    expect(storage.getItem('k4')).toBe('v');
    expect(storage.getItem('k0')).toBeNull();
  });

  it('очистка трогает только ключи кэша CRM', () => {
    const storage = memoryStorage();
    storage.setItem(`${CACHE_PREFIX}u1:k::{}`, '{}');
    storage.setItem(INDEX_KEY, '[]');
    storage.setItem('crm.theme', 'dark');
    clearStoredCache(storage);
    expect([...storage.map.keys()]).toEqual(['crm.theme']);
    expect(() => clearStoredCache(null)).not.toThrow();
  });
});
