import { computed } from 'vue';

import { PROFILE_ROUTE_NAME, PROFILE_TABS } from '../profile.domain';

import { useRouteTabs } from '@/shared/composables';

/**
 * Вкладки «Профиль» / «Безопасность» — в URL (`/profile/:tab?`). Старый адрес
 * `/profile/security` (отдельный пункт до TASK-073) открывает вторую вкладку.
 * Обе вкладки есть у всех: ни одна не гейтится фичей.
 */
export function useProfileTabs() {
  const open = computed(() => PROFILE_TABS);
  const { active, activeKey } = useRouteTabs(PROFILE_ROUTE_NAME, 'tab', open);
  return { open, active, activeKey };
}
