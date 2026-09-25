import type { PaymentsOptions } from '../../payments.domain';

import { paymentsApi } from '../../api/paymentsApi.payments';

import { useBaseState } from '@/shared/composables';

/** Варианты формы «Платежей»: грузятся при открытии раздела, один раз за сессию. */
export function usePaymentsOptions() {
  const [options, setOptions, , resetOptions] = useBaseState<PaymentsOptions | null>(null);
  const [optionsError, setOptionsError, , resetOptionsError] = useBaseState<string | null>(null);

  async function loadOptions(): Promise<void> {
    if (options.value !== null) return;
    setOptionsError(null);
    try {
      setOptions(await paymentsApi.options());
    } catch (error) {
      setOptionsError(
        error instanceof Error ? error.message : 'Не удалось загрузить форму отчёта.',
      );
    }
  }

  function reset(): void {
    resetOptions();
    resetOptionsError();
  }

  return { options, optionsError, loadOptions, reset };
}
