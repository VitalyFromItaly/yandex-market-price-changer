import type { PriceCalcRatesResponse } from '../../price-calculator.domain';

import { PRICE_CALC_RATES_KIND } from '../../price-calculator.domain';

import { useReportJob } from '@/shared/composables';

/**
 * Ставки из журнала — задача уровня аккаунта (`store: ''`) без параметров:
 * окно 30 дней считает сервер. Запрос один, поэтому чужого результата не
 * бывает. Повторный вход в раздел задачу не ставит (`ensure`), свежий факт —
 * «Обновить».
 */
export function useCalcRates() {
  const job = useReportJob<PriceCalcRatesResponse, true>({
    launch: () => ({ kind: PRICE_CALC_RATES_KIND, params: {}, store: '' }),
    isOwn: () => true,
  });

  function ensure(): void {
    if (job.data.value === null && !job.isLoading.value) void job.run(true);
  }

  return {
    data: job.data,
    isLoading: job.isLoading,
    isRefreshing: job.isRefreshing,
    savedAt: job.savedAt,
    error: job.error,
    ensure,
    refresh: () => void job.run(true),
    retry: job.retry,
    reset: job.reset,
  };
}
