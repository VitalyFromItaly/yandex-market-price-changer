import type { AccountingTabMeta } from '../accounting.domain';

import { computed } from 'vue';

import { ACCOUNTING_FEATURE, ACCOUNTING_ROUTE_NAME } from '../accounting.domain';
import { ACCOUNTING_TABS } from '../constants/tabs.accounting';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useRouteTabs } from '@/shared/composables';

/** Вкладки, открытые продавцу: без зонтика — ни одной; подфича открывает свою только поверх него. */
export function openAccountingTabs(
  features: Record<string, boolean> | undefined,
): AccountingTabMeta[] {
  if (features?.[ACCOUNTING_FEATURE] !== true) return [];
  return ACCOUNTING_TABS.filter((tab) => !tab.feature || features[tab.feature] === true);
}

/** Вкладка — в URL (`/ym/accounting/:tab?`): F5 возвращает в ту же. */
export function useAccountingTabs() {
  const auth = useAuthStore();
  const open = computed(() => openAccountingTabs(auth.me?.features));
  return { open, ...useRouteTabs(ACCOUNTING_ROUTE_NAME, 'tab', open) };
}
