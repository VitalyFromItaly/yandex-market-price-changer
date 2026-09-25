import type { MarketReportTab } from '../market-reports.domain';

import { computed } from 'vue';

import { MARKET_REPORTS_ROUTE_NAME } from '../market-reports.domain';
import { useMarketReportsStore } from '../store/store.market-reports';

import { useRouteTabs } from '@/shared/composables';

/** Отчёты открытого магазина — с сервера; оборачиваемость у не-FBY там уже скрыта. */
export function openMarketReports(tabs: readonly MarketReportTab[] | undefined): MarketReportTab[] {
  return tabs ? [...tabs] : [];
}

/** Активная вкладка — в URL (`/ym/stores/:store/market-reports/:report?`), см. useRouteTabs. */
export function useMarketReportTabs() {
  const store = useMarketReportsStore();
  const open = computed(() => openMarketReports(store.options?.reports));
  const { active, activeKey } = useRouteTabs(MARKET_REPORTS_ROUTE_NAME, 'report', open);
  return { open, active, activeKey };
}
