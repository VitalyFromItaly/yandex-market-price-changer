import type {
  SalesMetric,
  SalesSku,
  SalesSlice,
  SkuSort,
  TimeGrain,
} from '../../sales-analytics.domain';
import type { Ref } from 'vue';

import { computed } from 'vue';

import { filterSkus } from '../../mappers/mapSalesAnalytics.sales-analytics';

import { useBaseState } from '@/shared/composables';

/** Вид экрана: разрез, шаг и метрика графика, поиск и сортировка товаров. */
export function useSalesView(skus: Ref<readonly SalesSku[]>) {
  const [slice, setSlice, , resetSlice] = useBaseState<SalesSlice>('time');
  const [grain, setGrain, , resetGrain] = useBaseState<TimeGrain>('day');
  const [metric, setMetric, , resetMetric] = useBaseState<SalesMetric>('revenue');
  const [query, setQuery, , resetQuery] = useBaseState('');
  const [sort, setSort, , resetSort] = useBaseState<SkuSort>('revenue');

  const visibleSkus = computed(() => filterSkus(skus.value, query.value, sort.value));

  function reset(): void {
    resetSlice();
    resetGrain();
    resetMetric();
    resetQuery();
    resetSort();
  }

  return {
    slice,
    grain,
    metric,
    query,
    sort,
    visibleSkus,
    setSlice,
    setGrain,
    setMetric,
    setQuery,
    setSort,
    reset,
  };
}
