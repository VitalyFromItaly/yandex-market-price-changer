import type { OrderFeedResponse } from '../../order-feed.domain';
import type { MarketplaceKey } from '@/navigation.sections';
import type { ReportPeriod } from '@/shared/period';

import { ORDER_FEED_KIND } from '../../order-feed.domain';

import { useBaseState, useReportJob } from '@/shared/composables';
import { PERIOD, periodParams, samePeriod } from '@/shared/period';

/** По умолчанию — неделя: «сегодня» у ленты почти всегда пусто по журналу. */
const DEFAULT_FEED_PERIOD: ReportPeriod = { key: PERIOD.WEEK, day: null };

/**
 * Список ленты: период, площадка экрана (TASK-182, из адреса) и фоновая задача
 * уровня аккаунта (`store: ''`). Сверка эха периода и площадки и один перезапуск
 * — в useReportJob. Повторный вход в раздел с тем же периодом задачу не ставит —
 * свежий список берётся «Обновить».
 */
export function useOrderFeedList() {
  const [period, setPeriod, , resetPeriod] = useBaseState<ReportPeriod>(DEFAULT_FEED_PERIOD);
  const [marketplace, setMarketplace, , resetMarketplace] = useBaseState<MarketplaceKey>('ym');
  const job = useReportJob<OrderFeedResponse, ReportPeriod>({
    launch: (current) => ({
      kind: ORDER_FEED_KIND,
      params: { ...periodParams(current), marketplace: marketplace.value },
      store: '',
    }),
    isOwn: (data, current) =>
      (data.marketplace ?? 'ym') === marketplace.value && samePeriod(data.period, current),
  });

  /** При открытии раздела: уже собирается или есть за этот период — не ставим. */
  function ensure(): void {
    const current = job.request.value;
    if (current !== null && samePeriod(current, period.value)) return;
    void job.run(period.value);
  }

  /** Площадка экрана; другая — ответ прежней сброшен, период остаётся, `ensure` поставит задачу. */
  function selectMarketplace(next: MarketplaceKey): void {
    if (next === marketplace.value) return;
    job.reset();
    setMarketplace(next);
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
    resetMarketplace();
  }

  return {
    period,
    marketplace,
    data: job.data,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    ensure,
    selectMarketplace,
    selectPeriod,
    refresh,
    retry: job.retry,
    reset,
  };
}
