import type { TopSkuRow, TopSkusRequest, TopSkusResponse } from '../top-skus.domain';

import { defineStore } from 'pinia';
import { computed } from 'vue';

import {
  isOwnTopSkus,
  placeViews,
  topSkusParams,
  visibleSkus,
} from '../mappers/mapTopSkus.top-skus';
import { TOP_SKUS_KIND } from '../top-skus.domain';

import { useTopSkusPeriod } from './composables/useTopSkusPeriod.top-skus';
import { useTopSkusView } from './composables/useTopSkusView.top-skus';

import { useReportJob } from '@/shared/composables';

/** Стор «Топа товаров» — фасад: период, фоновая задача магазина и вид таблицы. */
export const useTopSkusStore = defineStore('top-skus', () => {
  const period = useTopSkusPeriod();
  const view = useTopSkusView();

  const job = useReportJob<TopSkusResponse, TopSkusRequest>({
    launch: (request) => ({
      kind: TOP_SKUS_KIND,
      params: topSkusParams(request),
      store: request.store,
    }),
    isOwn: isOwnTopSkus,
  });

  const skus = computed<TopSkuRow[]>(() =>
    visibleSkus(job.data.value?.skus ?? [], view.query.value, view.sort.value),
  );
  const soldCount = computed(
    () => (job.data.value?.skus ?? []).filter((row) => row.count > 0).length,
  );
  const regions = computed(() =>
    placeViews(job.data.value?.byRegion, job.data.value?.revenue ?? 0),
  );
  const clusters = computed(() =>
    placeViews(job.data.value?.byCluster, job.data.value?.revenue ?? 0),
  );

  /** Собрать топ открытого магазина за выбранный период. */
  function load(store: string): void {
    const range = period.range.value;
    if (range !== null) void job.run({ store, range });
  }

  return {
    ...period,
    ...view,
    data: job.data,
    skus,
    soldCount,
    regions,
    clusters,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    load,
    retry: job.retry,
    reset() {
      period.reset();
      view.reset();
      job.reset();
    },
  };
});
