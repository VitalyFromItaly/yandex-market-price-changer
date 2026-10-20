import type { ClassFilter, RatingSku, RatingTopKey } from '../../sku-ratings.domain';
import type { Ref } from 'vue';

import { computed } from 'vue';

import { filterClassified } from '../../mappers/mapSkuRatings.sku-ratings';

import { useBaseState } from '@/shared/composables';

/** Вид экрана: выбранный ТОП-лист, фильтры классов и поиск в таблице классов. */
export function useRatingsView(skus: Ref<readonly RatingSku[]>) {
  const [top, setTop, , resetTop] = useBaseState<RatingTopKey>('revenue');
  const [abc, setAbc, , resetAbc] = useBaseState<ClassFilter>('all');
  const [xyz, setXyz, , resetXyz] = useBaseState<ClassFilter>('all');
  const [query, setQuery, , resetQuery] = useBaseState('');

  const visibleSkus = computed(() =>
    filterClassified(skus.value, { query: query.value, abc: abc.value, xyz: xyz.value }),
  );

  function reset(): void {
    resetTop();
    resetAbc();
    resetXyz();
    resetQuery();
  }

  return { top, abc, xyz, query, visibleSkus, setTop, setAbc, setXyz, setQuery, reset };
}
