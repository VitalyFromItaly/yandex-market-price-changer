import type { UnitEconomicsResponse, UnitRequest, UnitSku } from '../unit-economics.domain';

import { defineStore } from 'pinia';
import { computed } from 'vue';

import { UNIT_ECONOMICS_KIND } from '../unit-economics.domain';

import { useUnitPeriod } from './composables/useUnitPeriod.unit-economics';
import { useUnitView } from './composables/useUnitView.unit-economics';

import { useReportJob } from '@/shared/composables';
import { sameRange } from '@/shared/period';

/**
 * Стор «Unit-экономики» — фасад: период, фоновая задача уровня аккаунта
 * (`store: ''`) и вид таблицы. Замок задачи — на (продавец, kind), поэтому
 * ответ сверяется с эхом обоих периодов: быстрое переключение иначе показало
 * бы прошлый.
 */
export const useUnitEconomicsStore = defineStore('unit-economics', () => {
  const period = useUnitPeriod();

  const job = useReportJob<UnitEconomicsResponse, UnitRequest>({
    launch: (request) => ({
      kind: UNIT_ECONOMICS_KIND,
      params: {
        from: request.range.from,
        to: request.range.to,
        prevFrom: request.previous.from,
        prevTo: request.previous.to,
      },
      store: '',
    }),
    isOwn: (data, request) =>
      sameRange(data.period, request.range) && sameRange(data.previousPeriod, request.previous),
  });

  const skus = computed<readonly UnitSku[]>(() => job.data.value?.skus ?? []);
  const view = useUnitView(skus);

  function load(): void {
    const request = period.request.value;
    if (request !== null) void job.run(request);
  }

  return {
    ...period,
    ...view,
    data: job.data,
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
