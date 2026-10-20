import type { FinanceTabMeta } from '../finance.domain';

import { computed } from 'vue';

import { FINANCE_TABS } from '../constants/tabs.finance';
import { FINANCE_ROUTE_NAME } from '../finance.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useRouteTabs } from '@/shared/composables';

/**
 * Вкладки, открытые продавцу. Раздел открывает `finance`; у вкладки со своей
 * фичей (`anomalies`) — ещё она: закрытая вела бы в 403.
 */
export function openFinanceTabs(features: Record<string, boolean> | undefined): FinanceTabMeta[] {
  return FINANCE_TABS.filter((tab) => !tab.feature || features?.[tab.feature] === true);
}

/** Вкладка — в URL (`/ym/finance/:tab?`): F5 возвращает в ту же. */
export function useFinanceTabs() {
  const auth = useAuthStore();
  const open = computed(() => openFinanceTabs(auth.me?.features));
  return { open, ...useRouteTabs(FINANCE_ROUTE_NAME, 'tab', open) };
}
