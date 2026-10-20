import type { PriceCalcTariffResponse, TariffRequest } from '../../price-calculator.domain';

import { PRICE_CALC_TARIFF_KIND } from '../../price-calculator.domain';

import { useBaseState, useReportJob } from '@/shared/composables';

/**
 * Сверка с тарифом Маркета — задача по магазину (решение
 * `price_calc_tariff_check`). Тариф зависит от цены, поэтому ответ сверяется
 * с запросом по артикулу и цене. Не хранится: это ответ на кнопку, и после
 * перезагрузки старый тариф под новой ценой вводил бы в заблуждение.
 */
export function useTariffQuote() {
  const [store, setStore, , resetStore] = useBaseState('');
  const job = useReportJob<PriceCalcTariffResponse, TariffRequest>({
    launch: (r) => ({
      kind: PRICE_CALC_TARIFF_KIND,
      params: { sku: r.sku, priceKopecks: r.priceKopecks },
      store: r.store,
    }),
    isOwn: (data, r) => data.sku === r.sku && data.priceKopecks === r.priceKopecks,
    persist: false,
  });

  function request(sku: string, priceKopecks: number): void {
    if (store.value === '') return;
    void job.run({ store: store.value, sku, priceKopecks });
  }

  return {
    store,
    setStore,
    tariff: job.data,
    isLoading: job.isLoading,
    error: job.error,
    request,
    reset() {
      resetStore();
      job.reset();
    },
  };
}
