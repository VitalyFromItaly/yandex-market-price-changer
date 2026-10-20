import type { ReturnsMarketplace, ReturnsSlice } from '../../returns-analytics.domain';
import type { Ref } from 'vue';

import { computed } from 'vue';

import { filterReturnSkus } from '../../mappers/mapReturnsAnalytics.returns-analytics';

import { useBaseState } from '@/shared/composables';

/**
 * Вид экрана: площадка, разрез и поиск товара. Выбранной площадки в ответе
 * может не быть (функцию закрыли) — тогда первая из пришедших.
 */
export function useReturnsView(marketplaces: Ref<readonly ReturnsMarketplace[]>) {
  const [slice, setSlice, , resetSlice] = useBaseState<ReturnsSlice>('brand');
  const [marketplace, setMarketplace, , resetMarketplace] = useBaseState('ym');
  const [query, setQuery, , resetQuery] = useBaseState('');

  const current = computed<ReturnsMarketplace | null>(
    () =>
      marketplaces.value.find((m) => m.marketplace === marketplace.value) ??
      marketplaces.value[0] ??
      null,
  );
  const visibleSkus = computed(() =>
    current.value ? filterReturnSkus(current.value.skus, query.value) : [],
  );

  function reset(): void {
    resetSlice();
    resetMarketplace();
    resetQuery();
  }

  return {
    slice,
    marketplace,
    query,
    current,
    visibleSkus,
    setSlice,
    setMarketplace,
    setQuery,
    reset,
  };
}
