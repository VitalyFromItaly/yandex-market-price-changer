import type { MarketReportsOptions } from '../../market-reports.domain';

import { marketReportsApi } from '../../api/marketReportsApi.market-reports';

import { useBaseState } from '@/shared/composables';

/** Список отчётов открытого магазина и варианты форм: грузятся при открытии раздела. */
export function useMarketReportsOptions() {
  const [options, setOptions, isOptionsLoading, resetOptions] =
    useBaseState<MarketReportsOptions | null>(null);
  const [optionsError, setOptionsError, , resetOptionsError] = useBaseState<string | null>(null);
  let loadedFor: string | null = null;

  /** Список зависит от модели магазина (оборачиваемость — только FBY). */
  async function loadOptions(store: string): Promise<void> {
    if (options.value !== null && loadedFor === store) return;
    setOptionsError(null);
    try {
      setOptions(await marketReportsApi.options(store));
      loadedFor = store;
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : 'Не удалось загрузить отчёты.');
    }
  }

  function reset(): void {
    resetOptions();
    resetOptionsError();
    loadedFor = null;
  }

  return { options, isOptionsLoading, optionsError, loadOptions, reset };
}
