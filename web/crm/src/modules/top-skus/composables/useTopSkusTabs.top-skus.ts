import { computed } from 'vue';

import { DEEP_HISTORY_FEATURE, TOP_SKUS_ROUTE_NAME, TOP_SKUS_TABS } from '../top-skus.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useRouteTabs } from '@/shared/composables';

/**
 * Вкладки «Топа товаров» в URL (`:tab?`). Все три вкладки открыты всегда:
 * сервер считает разрезы по месту на каждом запросе.
 */
export function useTopSkusTabs() {
  const auth = useAuthStore();
  const places = computed(() => true);
  const deepHistory = computed(() => auth.me?.features[DEEP_HISTORY_FEATURE] === true);
  const open = computed(() => TOP_SKUS_TABS);
  const { active, activeKey } = useRouteTabs(TOP_SKUS_ROUTE_NAME, 'tab', open);
  return { open, active, activeKey, places, deepHistory };
}
