import type { UnitEconomicsResponse, UnitRequest, UnitSku } from '../unit-economics.domain';
import type { MarketplaceKey } from '@/navigation.sections';

import { defineStore } from 'pinia';
import { computed } from 'vue';

import { UNIT_ECONOMICS_KIND } from '../unit-economics.domain';

import { useUnitPeriod } from './composables/useUnitPeriod.unit-economics';
import { useUnitView } from './composables/useUnitView.unit-economics';

import { useBaseState, useReportJob } from '@/shared/composables';
import { sameRange } from '@/shared/period';

/**
 * Стор «Unit-экономики» — фасад: период, фоновая задача уровня аккаунта
 * (`store: ''`) и вид таблицы. Замок задачи — на (продавец, kind), поэтому
 * ответ сверяется с эхом обоих периодов: быстрое переключение иначе показало
 * бы прошлый. Площадка (TASK-181) — из адреса, тоже часть эха.
 */
export const useUnitEconomicsStore = defineStore('unit-economics', () => {
  const period = useUnitPeriod();
  const [marketplace, setMarketplace, , resetMarketplace] = useBaseState<MarketplaceKey>('ym');

  const job = useReportJob<UnitEconomicsResponse, UnitRequest>({
    launch: (request) => ({
      kind: UNIT_ECONOMICS_KIND,
      params: {
        from: request.range.from,
        to: request.range.to,
        prevFrom: request.previous.from,
        prevTo: request.previous.to,
        marketplace: marketplace.value,
      },
      store: '',
    }),
    isOwn: (data, request) =>
      (data.marketplace ?? 'ym') === marketplace.value &&
      sameRange(data.period, request.range) &&
      sameRange(data.previousPeriod, request.previous),
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
    marketplace,
    load,
    retry: job.retry,
    /** Площадка экрана (TASK-181); другая — ответ прежней сброшен, период остаётся. */
    selectMarketplace(next: MarketplaceKey): void {
      if (next === marketplace.value) return;
      job.reset();
      setMarketplace(next);
    },
    reset() {
      period.reset();
      view.reset();
      job.reset();
      resetMarketplace();
    },
  };
});
