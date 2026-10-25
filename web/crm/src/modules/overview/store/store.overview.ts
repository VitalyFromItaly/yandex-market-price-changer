import type {
  CancelledResponse,
  KpiKey,
  KpiView,
  StocksResponse,
  SummaryResponse,
} from '../overview.domain';
import type { MarketplaceKey } from '@/navigation.sections';

import { defineStore } from 'pinia';
import { computed } from 'vue';

import { mapCancelledKpi, mapStocksKpis, mapSummaryKpis } from '../mappers/mapOverview.overview';
import {
  OVERVIEW_CANCELLED_KIND,
  OVERVIEW_STOCKS_KIND,
  OVERVIEW_SUMMARY_KIND,
} from '../overview.domain';

import { useOverviewPeriod } from './composables/useOverviewPeriod.overview';
import { useOverviewSource } from './composables/useOverviewSource.overview';

import { useBaseState } from '@/shared/composables';
import { sameRange } from '@/shared/period';

/**
 * Стор «Обзора» — фасад: период и площадка, три источника карточек. Площадку
 * задаёт адрес (TASK-183, решение crm_marketplace_screens_own_only) — страница
 * передаёт её `selectMarketplace`; своего переключателя площадок у экрана нет.
 * Сводка денег грузится, только если «Финансы» открыты (`withMoney`): иначе
 * задача получила бы 403 гейта, а экран говорит причину словами.
 */
export const useOverviewStore = defineStore('overview', () => {
  const period = useOverviewPeriod();
  const [marketplace, setMarketplace, , resetMarketplace] = useBaseState<MarketplaceKey>('ym');

  const summary = useOverviewSource<SummaryResponse>(
    {
      kind: OVERVIEW_SUMMARY_KIND,
      withRange: true,
      isOwn: (data, request) =>
        sameRange(data.current, request.range) && sameRange(data.previous, request.previous),
      toKpis: mapSummaryKpis,
    },
    marketplace,
  );
  const stocks = useOverviewSource<StocksResponse>(
    {
      kind: OVERVIEW_STOCKS_KIND,
      withRange: false,
      isOwn: () => true,
      toKpis: mapStocksKpis,
    },
    marketplace,
  );
  const cancelled = useOverviewSource<CancelledResponse>(
    {
      kind: OVERVIEW_CANCELLED_KIND,
      withRange: true,
      isOwn: (data, request) => sameRange(data, request.range),
      toKpis: mapCancelledKpi,
    },
    marketplace,
  );

  const kpis = computed<Partial<Record<KpiKey, KpiView>>>(() => ({
    ...summary.kpis.value,
    ...stocks.kpis.value,
    ...cancelled.kpis.value,
  }));

  /** Карточки, зависящие от периода, перезапускаются при его смене; срез «сейчас» — нет. */
  function loadPeriod(withMoney: boolean): void {
    const request = period.request.value;
    if (request === null) return;
    if (withMoney) void summary.load(request);
    void cancelled.load(request);
  }

  function load(withMoney: boolean): void {
    loadPeriod(withMoney);
    const request = period.request.value;
    if (request !== null) void stocks.load(request);
  }

  /** Площадка экрана; другая — ответы прежней сброшены, загрузку ставит страница. */
  function selectMarketplace(next: MarketplaceKey): void {
    if (next === marketplace.value) return;
    summary.reset();
    stocks.reset();
    cancelled.reset();
    setMarketplace(next);
  }

  return {
    ...period,
    marketplace,
    selectMarketplace,
    summary,
    stocks,
    cancelled,
    kpis,
    load,
    loadPeriod,
    reset() {
      period.reset();
      resetMarketplace();
      summary.reset();
      stocks.reset();
      cancelled.reset();
    },
  };
});
