import type { TopSkusSort } from '../../top-skus.domain';

import { useBaseState } from '@/shared/composables';

/** Вид таблицы товаров: поиск и сортировка. Состояние экрана, не данные. */
export function useTopSkusView() {
  const [query, setQuery, , resetQuery] = useBaseState<string>('');
  const [sort, setSort, , resetSort] = useBaseState<TopSkusSort>('revenue');

  function reset(): void {
    resetQuery();
    resetSort();
  }

  return { query, setQuery, sort, setSort, reset };
}
