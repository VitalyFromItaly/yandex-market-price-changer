import { describe, expect, it } from 'vitest';

import { useBaseState } from './useBaseState';

describe('useBaseState', () => {
  it('set меняет состояние, hasState отличает пустое от заполненного', () => {
    const [items, setItems, , , hasItems] = useBaseState<number[]>([]);
    expect(hasItems.value).toBe(false);
    setItems([1, 2]);
    expect(items.value).toEqual([1, 2]);
    expect(hasItems.value).toBe(true);
  });

  it('null — «данных нет», а не данные', () => {
    const [value, setValue, , , hasValue] = useBaseState<{ a: number } | null>(null);
    expect(hasValue.value).toBe(false);
    setValue({ a: 0 });
    expect(hasValue.value).toBe(true);
    expect(value.value).toEqual({ a: 0 });
  });

  it('reset возвращает начальное значение, даже если массив мутировали на месте', () => {
    const [items, , isLoading, resetItems] = useBaseState<number[]>([]);
    items.value.push(5);
    isLoading.value = true;
    resetItems();
    expect(items.value).toEqual([]);
    expect(isLoading.value).toBe(false);
    items.value.push(6);
    resetItems();
    expect(items.value).toEqual([]);
  });
});
