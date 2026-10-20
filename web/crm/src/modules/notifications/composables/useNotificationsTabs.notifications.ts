import { computed } from 'vue';

import { NOTIFICATIONS_ROUTE_NAME, NOTIFICATIONS_TABS } from '../notifications.domain';

import { useRouteTabs } from '@/shared/composables';

/** Активная вкладка — в URL (`/ym/notifications/:tab?`), см. useRouteTabs. */
export function useNotificationsTabs() {
  const open = computed(() => NOTIFICATIONS_TABS);
  const { active, activeKey } = useRouteTabs(NOTIFICATIONS_ROUTE_NAME, 'tab', open);
  return { tabs: open, active, activeKey };
}
