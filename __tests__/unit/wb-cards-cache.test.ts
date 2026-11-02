import { describe, expect, it, vi } from 'vitest';

import { WB_CARDS_TTL_MS, WbCardsCache } from '../../src/modules/wb/wb-cards-cache';

describe('WbCardsCache (wb_cards_cache_per_token)', () => {
  it('параллельные и последующие вызовы одного токена — один обход', async () => {
    const cache = new WbCardsCache<string[]>();
    const load = vi.fn().mockResolvedValue(['a']);

    const [first, second] = await Promise.all([cache.get('t', load), cache.get('t', load)]);
    const third = await cache.get('t', load);

    expect(load).toHaveBeenCalledTimes(1);
    expect([first, second, third]).toEqual([['a'], ['a'], ['a']]);
  });

  it('разные токены — разные обходы', async () => {
    const cache = new WbCardsCache<string[]>();
    const load = vi.fn().mockResolvedValue([]);

    await cache.get('t1', load);
    await cache.get('t2', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ошибка не кэшируется — следующий вызов идёт заново', async () => {
    const cache = new WbCardsCache<string[]>();
    const load = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue(['b']);

    await expect(cache.get('t', load)).rejects.toThrow('429');
    await expect(cache.get('t', load)).resolves.toEqual(['b']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('по истечении TTL — новый обход', async () => {
    let now = 0;
    const cache = new WbCardsCache<string[]>(WB_CARDS_TTL_MS, () => now);
    const load = vi.fn().mockResolvedValue([]);

    await cache.get('t', load);
    now = WB_CARDS_TTL_MS - 1;
    await cache.get('t', load);
    now = WB_CARDS_TTL_MS;
    await cache.get('t', load);

    expect(load).toHaveBeenCalledTimes(2);
  });
});
