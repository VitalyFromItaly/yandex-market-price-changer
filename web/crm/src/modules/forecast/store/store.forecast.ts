import type {
  BasisDays,
  ForecastResponse,
  PurchasesRequest,
  PurchasesResponse,
} from '../forecast.domain';
import type { MarketplaceKey } from '@/navigation.sections';

import { defineStore } from 'pinia';

import { FORECAST_KIND, FORECAST_PURCHASES_KIND } from '../forecast.domain';

import { useForecastSettings } from './composables/useForecastSettings.forecast';

import { useBaseState, useReportJob } from '@/shared/composables';
import { moscowToday } from '@/shared/utils';

interface ForecastRequest {
  basisDays: BasisDays;
  today: string;
}

/**
 * Стор «Прогнозов» — фасад: настройки и две фоновые задачи уровня аккаунта
 * (`store: ''`). Прогноз грузится при открытии и смене окна; закупки — только
 * кнопкой (решение `forecast_purchases_button`: это остатки из Маркета по всем
 * магазинам). Ответы сверяются с эхом параметров: замок задачи — на (продавец,
 * kind), и быстрое переключение иначе показало бы прошлый расчёт.
 */
export const useForecastStore = defineStore('forecast', () => {
  const settings = useForecastSettings();
  const [marketplace, setMarketplace, , resetMarketplace] = useBaseState<MarketplaceKey>('ym');
  const isOwnMarketplace = (data: { marketplace?: MarketplaceKey }) =>
    (data.marketplace ?? 'ym') === marketplace.value;

  const summary = useReportJob<ForecastResponse, ForecastRequest>({
    launch: (request) => ({
      kind: FORECAST_KIND,
      params: { basisDays: request.basisDays, marketplace: marketplace.value },
      store: '',
    }),
    isOwn: (data, request) =>
      isOwnMarketplace(data) &&
      data.basisDays === request.basisDays &&
      data.today === request.today,
  });

  const purchases = useReportJob<PurchasesResponse, PurchasesRequest>({
    launch: (request) => ({
      kind: FORECAST_PURCHASES_KIND,
      params: {
        basisDays: request.basisDays,
        coverDays: request.coverDays,
        marketplace: marketplace.value,
      },
      store: '',
    }),
    isOwn: (data, request) =>
      isOwnMarketplace(data) &&
      data.basisDays === request.basisDays &&
      data.coverDays === request.coverDays,
  });

  function load(): void {
    void summary.run({ basisDays: settings.basisDays.value, today: moscowToday() });
  }

  function loadPurchases(): void {
    void purchases.run({
      basisDays: settings.basisDays.value,
      coverDays: settings.coverDays.value,
    });
  }

  /** Площадка экрана (из адреса); другая — оба расчёта прежней сброшены, грузит страница. */
  function selectMarketplace(next: MarketplaceKey): void {
    if (next === marketplace.value) return;
    summary.reset();
    purchases.reset();
    setMarketplace(next);
  }

  return {
    ...settings,
    marketplace,
    selectMarketplace,
    data: summary.data,
    isLoading: summary.isLoading,
    isRefreshing: summary.isRefreshing,
    savedAt: summary.savedAt,
    error: summary.error,
    retry: summary.retry,
    load,
    purchases: purchases.data,
    purchasesLoading: purchases.isLoading,
    purchasesError: purchases.error,
    loadPurchases,
    reset() {
      settings.reset();
      resetMarketplace();
      summary.reset();
      purchases.reset();
    },
  };
});
