import type { PaymentsReport, PaymentsReportResponse } from '../../payments.domain';

import { computed } from 'vue';

import { mapPaymentsReport } from '../../mappers/mapPayments.payments';
import { PAYMENTS_JOB_KIND } from '../../payments.domain';

import { useBaseState, useReportJob } from '@/shared/composables';

interface Request {
  period: string;
  /** Ключ открытого магазина. */
  store: string;
}

/**
 * Отчёт по платежам: выбранный период, фоновая задача и её результат. Сверка
 * эха периода и один перезапуск — в useReportJob.
 */
export function usePaymentsReport() {
  const [period, setPeriod, , resetPeriod] = useBaseState<string | null>(null);
  const job = useReportJob<PaymentsReportResponse, Request>({
    launch: (current) => ({
      kind: PAYMENTS_JOB_KIND,
      params: { period: current.period },
      store: current.store,
    }),
    isOwn: (data, current) => data.period === current.period,
    // Результат — файл по кнопке; ссылка на задачу после суток не откроется.
    persist: false,
  });

  const report = computed<PaymentsReport | null>(() =>
    job.data.value === null ? null : mapPaymentsReport(job.data.value),
  );

  function selectPeriod(next: string): void {
    setPeriod(next);
  }

  /** Заказать отчёт у Маркета за выбранный период. */
  function generate(store: string): Promise<void> {
    if (period.value === null) return Promise.resolve();
    return job.run({ period: period.value, store });
  }

  function download(): Promise<void> {
    return job.download(report.value?.filename ?? undefined);
  }

  function reset(): void {
    job.reset();
    resetPeriod();
  }

  return {
    period,
    selectPeriod,
    report,
    /** Запрос уже был — иначе экран зовёт «Сформировать». */
    requested: computed(() => job.request.value !== null),
    isLoading: job.isLoading,
    error: job.error,
    generate,
    retry: job.retry,
    download,
    reset,
  };
}
