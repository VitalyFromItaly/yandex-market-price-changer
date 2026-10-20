import type { ProfitReportMeta } from '../profit.domain';

import { computed } from 'vue';

import { DEEP_HISTORY_FEATURE, PROFIT_ACTUAL_FEATURE, PROFIT_REPORTS } from '../profit.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useStoresStore } from '@/modules/stores/store/store.stores';
import { useRouteTabs } from '@/shared/composables';

export const PROFIT_ROUTE_NAME = 'ym-profit';

/**
 * Вкладки, открытые продавцу. Раздел виден, если открыта хоть одна
 * (CRM_SECTIONS: report_profit ИЛИ tariff_calc); закрытая вкладка вела бы в 403.
 */
export function openProfitReports(
  features: Record<string, boolean> | undefined,
): ProfitReportMeta[] {
  return PROFIT_REPORTS.filter((meta) => features?.[meta.feature] === true);
}

/** Активная вкладка — в URL (`/ym/stores/:store/profit/:report?`), см. useRouteTabs. */
export function useProfitTabs() {
  const auth = useAuthStore();
  const stores = useStoresStore();

  const open = computed(() => openProfitReports(auth.me?.features));
  const { active, activeKey } = useRouteTabs(PROFIT_ROUTE_NAME, 'report', open);

  const deepHistory = computed(() => auth.me?.features[DEEP_HISTORY_FEATURE] === true);
  /**
   * «Прошлый месяц» — у вкладки «Прибыль» при profit_actual и deep_history
   * (isPrevMonthOpen бэкенда): начало месяца почти всегда старше 30 дней.
   */
  const prevMonth = computed(
    () => deepHistory.value && auth.me?.features[PROFIT_ACTUAL_FEATURE] === true,
  );
  /** Ведёт ли кнопка «Загрузить прайс» куда-то: раздел магазина мог быть закрыт. */
  const priceListOpen = computed(() => stores.current?.sections.includes('ym-price-list') === true);

  return { open, active, activeKey, deepHistory, prevMonth, priceListOpen };
}
