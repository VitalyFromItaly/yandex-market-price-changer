import type { ComputedRef } from 'vue';

import { computed, onMounted } from 'vue';

import { PUSH_SCHEDULE_MIN_MARKETPLACES, STOCK_PUSH_SCHEDULE_FEATURE } from '../stock-push.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useMarketplacesStore } from '@/modules/marketplaces/store/store.marketplaces';

/**
 * Показывать ли блок синхронизации: фича открыта администратором и подключено
 * две площадки и больше. С одной площадкой чужих продаж нет — блок только путал бы.
 */
export function usePushScheduleVisible(): ComputedRef<boolean> {
  const auth = useAuthStore();
  const marketplaces = useMarketplacesStore();
  onMounted(() => {
    void marketplaces.ensure();
  });
  return computed(
    () =>
      auth.me?.features[STOCK_PUSH_SCHEDULE_FEATURE] === true &&
      marketplaces.connections.filter((c) => c.connected).length >= PUSH_SCHEDULE_MIN_MARKETPLACES,
  );
}
