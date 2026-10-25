import type { ReturnsMarketplace, ReturnsSlice } from '../../returns-analytics.domain';
import type { MarketplaceKey } from '@/navigation.sections';
import type { Ref } from 'vue';

import { computed } from 'vue';

import { filterReturnSkus } from '../../mappers/mapReturnsAnalytics.returns-analytics';

import { useBaseState } from '@/shared/composables';

/**
 * Вид экрана: разрез и поиск товара. Площадка — экрана (из адреса, TASK-182):
 * её блок в ответе; журнал не прочитан — блока нет (причина — в problems).
 */
export function useReturnsView(
  marketplaces: Ref<readonly ReturnsMarketplace[]>,
  marketplace: Ref<MarketplaceKey>,
) {
  const [slice, setSlice, , resetSlice] = useBaseState<ReturnsSlice>('brand');
  const [query, setQuery, , resetQuery] = useBaseState('');

  const current = computed<ReturnsMarketplace | null>(
    () => marketplaces.value.find((m) => m.marketplace === marketplace.value) ?? null,
  );
  const visibleSkus = computed(() =>
    current.value ? filterReturnSkus(current.value.skus, query.value) : [],
  );

  function reset(): void {
    resetSlice();
    resetQuery();
  }

  return {
    slice,
    query,
    current,
    visibleSkus,
    setSlice,
    setQuery,
    reset,
  };
}
