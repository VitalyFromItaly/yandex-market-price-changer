import type { KpiKey, KpiView, OverviewRequest } from '../../overview.domain';
import type { MarketplaceKey } from '@/navigation.sections';
import type { Ref } from 'vue';

import { computed } from 'vue';

import { useReportJob } from '@/shared/composables';

export interface OverviewSourceSpec<T> {
  kind: string;
  /** Задаче нужен период (сводка, отмены); срезу «сейчас» — нет. */
  withRange: boolean;
  /** Ответ относится к этому запросу (эхо периода); эхо площадки сверяется здесь. */
  isOwn(data: T, request: OverviewRequest): boolean;
  toKpis(data: T): Partial<Record<KpiKey, KpiView>>;
}

/**
 * Один источник карточек «Обзора» — фоновая задача уровня аккаунта (`store: ''`).
 * Замок задачи — на (продавец, kind), поэтому ответ сверяется с эхом периода:
 * быстрые переключения периода иначе показали бы прошлый. Площадка экрана
 * (TASK-183) — в параметрах и в эхе: ответ другой площадки не свой.
 */
export function useOverviewSource<T extends { marketplace?: MarketplaceKey }>(
  spec: OverviewSourceSpec<T>,
  marketplace: Readonly<Ref<MarketplaceKey>>,
) {
  const job = useReportJob<T, OverviewRequest>({
    launch: (request) => ({
      kind: spec.kind,
      params: spec.withRange
        ? {
            from: request.range.from,
            to: request.range.to,
            prevFrom: request.previous.from,
            prevTo: request.previous.to,
            marketplace: marketplace.value,
          }
        : { marketplace: marketplace.value },
      store: '',
    }),
    isOwn: (data, request) =>
      (data.marketplace ?? 'ym') === marketplace.value && spec.isOwn(data, request),
  });

  const kpis = computed(() => (job.data.value === null ? {} : spec.toKpis(job.data.value)));

  return {
    data: job.data,
    kpis,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    load: (request: OverviewRequest) => job.run(request),
    retry: job.retry,
    reset: job.reset,
  };
}
