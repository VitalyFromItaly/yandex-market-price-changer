import type { MarketplaceKey } from '@/navigation';
import type { ComputedRef } from 'vue';

import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { marketplaceOfPath } from '@/navigation';

/**
 * Площадка из адреса — первый сегмент пути (`/ym/...`, `/ozon`, `/wb`), рядом
 * с `useStoreKey`. null — страница вне площадки (профиль, помощь).
 */
export function useMarketplace(): ComputedRef<MarketplaceKey | null> {
  const route = useRoute();
  return computed(() => marketplaceOfPath(route.path));
}
