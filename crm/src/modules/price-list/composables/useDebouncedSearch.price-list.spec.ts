import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';

import { SEARCH_DEBOUNCE_MS, useDebouncedSearch } from './useDebouncedSearch.price-list';

describe('useDebouncedSearch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ищет один раз — после паузы в наборе', async () => {
    const onSearch = vi.fn();
    const { text } = useDebouncedSearch('', onSearch);

    text.value = 'ca';
    await nextTick();
    text.value = 'casio';
    await nextTick();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(onSearch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledWith('casio');
  });

  it('уход со страницы гасит отложенный поиск', async () => {
    const onSearch = vi.fn();
    const scope = effectScope();
    const search = scope.run(() => useDebouncedSearch('', onSearch));
    if (!search) throw new Error('scope');

    search.text.value = 'x';
    await nextTick();
    scope.stop();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(onSearch).not.toHaveBeenCalled();
  });
});
