import type { OrderReportMeta } from '../orders.domain';

import { computed } from 'vue';

import { DEEP_HISTORY_FEATURE, ORDER_REPORTS } from '../orders.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { resolveTab, useRouteTabs } from '@/shared/composables';

export const ORDERS_ROUTE_NAME = 'ym-orders';

/**
 * Отчёты, открытые продавцу. Раздел виден, если открыт хоть один (CRM_SECTIONS),
 * а вкладки — только открытые: закрытая вкладка вела бы в 403 гейта.
 */
export function openReports(features: Record<string, boolean> | undefined): OrderReportMeta[] {
  return ORDER_REPORTS.filter((meta) => features?.[meta.feature] === true);
}

/** Вкладка из URL, если она открыта; иначе первая открытая; null — открытых нет. */
export function resolveReport(
  param: unknown,
  open: readonly OrderReportMeta[],
): OrderReportMeta | null {
  return resolveTab(param, open);
}

/** Активная вкладка — в URL (`/ym/stores/:store/orders/:report?`), см. useRouteTabs. */
export function useOrdersTabs() {
  const auth = useAuthStore();

  const open = computed(() => openReports(auth.me?.features));
  const { active, activeKey } = useRouteTabs(ORDERS_ROUTE_NAME, 'report', open);

  const deepHistory = computed(() => auth.me?.features[DEEP_HISTORY_FEATURE] === true);

  return { open, active, activeKey, deepHistory };
}
