import type { UnitSku, UnitSort } from '../../unit-economics.domain';
import type { Ref } from 'vue';

import { computed } from 'vue';

import { filterSkus } from '../../mappers/mapUnitEconomics.unit-economics';

import { useBaseState } from '@/shared/composables';

/**
 * Вид таблицы: поиск, сортировка и открытая карточка. Открытая карточка —
 * артикулом, а не объектом: после перезагрузки данных она показывает свежие
 * числа того же товара, а исчезнувший товар закрывает её сам.
 */
export function useUnitView(skus: Ref<readonly UnitSku[]>) {
  const [query, setQuery, , resetQuery] = useBaseState('');
  const [sort, setSort, , resetSort] = useBaseState<UnitSort>('revenue');
  const [openSku, setOpenSku, , resetOpenSku] = useBaseState<string | null>(null);

  const visible = computed(() => filterSkus(skus.value, query.value, sort.value));
  const opened = computed(() => skus.value.find((sku) => sku.sku === openSku.value) ?? null);

  function reset(): void {
    resetQuery();
    resetSort();
    resetOpenSku();
  }

  return {
    query,
    sort,
    visible,
    opened,
    setQuery,
    setSort,
    open: (sku: string) => setOpenSku(sku),
    close: () => setOpenSku(null),
    reset,
  };
}
