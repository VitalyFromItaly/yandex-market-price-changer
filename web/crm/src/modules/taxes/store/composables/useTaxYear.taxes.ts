import type { TaxYearRequest, TaxYearResponse } from '../../taxes.domain';

import { ref } from 'vue';

import { taxesApi } from '../../api/taxesApi.taxes';
import { TAX_YEAR_KIND } from '../../taxes.domain';

import { useReportJob } from '@/shared/composables';
import { moscowToday } from '@/shared/utils';

const currentYear = () => Number(moscowToday().slice(0, 4));

/**
 * Налоговый год: выбранный год и фоновая задача `taxes:year` уровня аккаунта
 * (`store: ''`). Ответ сверяется с эхом года — замок задачи общий на kind, и
 * быстрое переключение года иначе показало бы прошлый. Правки (уменьшения,
 * сверка, работники) меняют числа года — после них задача перезапускается.
 */
export function useTaxYear() {
  const year = ref<number>(currentYear());
  const staffSaving = ref(false);

  const job = useReportJob<TaxYearResponse, TaxYearRequest>({
    launch: (request) => ({ kind: TAX_YEAR_KIND, params: { year: request.year }, store: '' }),
    isOwn: (data, request) => data.year === request.year,
  });

  function load(): void {
    void job.run({ year: year.value });
  }

  function selectYear(next: number): void {
    if (next === year.value) return;
    year.value = next;
    load();
  }

  /** Ошибка пробрасывается: тост и откат переключателя — дело экрана. */
  async function setStaff(hasStaff: boolean): Promise<void> {
    staffSaving.value = true;
    try {
      await taxesApi.setStaff(hasStaff);
      load();
    } finally {
      staffSaving.value = false;
    }
  }

  function reset(): void {
    year.value = currentYear();
    staffSaving.value = false;
    job.reset();
  }

  return {
    year,
    yearView: job.data,
    yearLoading: job.isLoading,
    yearRefreshing: job.isRefreshing,
    yearSavedAt: job.savedAt,
    yearError: job.error,
    staffSaving,
    loadYear: load,
    retryYear: job.retry,
    selectYear,
    setStaff,
    resetYear: reset,
  };
}
