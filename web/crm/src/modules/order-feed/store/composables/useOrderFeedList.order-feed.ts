import type { OrderFeedResponse } from '../../order-feed.domain';
import type { ReportPeriod } from '@/shared/period';

import { ORDER_FEED_KIND } from '../../order-feed.domain';

import { useBaseState, useReportJob } from '@/shared/composables';
import { PERIOD, periodParams, samePeriod } from '@/shared/period';

/** По умолчанию — неделя: «сегодня» у ленты почти всегда пусто по журналу. */
const DEFAULT_FEED_PERIOD: ReportPeriod = { key: PERIOD.WEEK, day: null };

/**
 * Список ленты: период и фоновая задача уровня аккаунта (`store: ''`). Сверка
 * эха периода и один перезапуск — в useReportJob. Повторный вход в раздел с
 * тем же периодом задачу не ставит — свежий список берётся «Обновить».
 */
export function useOrderFeedList() {
  const [period, setPeriod, , resetPeriod] = useBaseState<ReportPeriod>(DEFAULT_FEED_PERIOD);
  const job = useReportJob<OrderFeedResponse, ReportPeriod>({
    launch: (current) => ({ kind: ORDER_FEED_KIND, params: periodParams(current), store: '' }),
    isOwn: (data, current) => samePeriod(data.period, current),
  });

  /** При открытии раздела: уже собирается или есть за этот период — не ставим. */
  function ensure(): void {
    const current = job.request.value;
    if (current !== null && samePeriod(current, period.value)) return;
    void job.run(period.value);
  }

  function selectPeriod(next: ReportPeriod): void {
    setPeriod(next);
    void job.run(next);
  }

  function refresh(): void {
    void job.run(period.value);
  }

  function reset(): void {
    job.reset();
    resetPeriod();
  }

  return {
    period,
    data: job.data,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    ensure,
    selectPeriod,
    refresh,
    retry: job.retry,
    reset,
  };
}
