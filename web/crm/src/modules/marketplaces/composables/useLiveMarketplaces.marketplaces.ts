import type { Marketplace, MarketplaceKey } from '@/navigation';
import type { ComputedRef } from 'vue';

import { computed } from 'vue';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import {
  isLiveMarketplace,
  liveMarketplaces,
  marketplaceHome,
  upcomingMarketplaces,
} from '@/navigation';

export interface LiveMarketplaces {
  live: ComputedRef<Marketplace[]>;
  upcoming: ComputedRef<Marketplace[]>;
  isLive: (mp: MarketplaceKey) => boolean;
  homeOf: (mp: MarketplaceKey) => string;
}

/**
 * Живые площадки продавца по `me.sections` — один список для переключателя,
 * карточки «Площадки», табов главной и аналитики (роутер — тем же правилом в
 * `useMarketplaceGuard`). Площадка «скоро» — пока сервер не открыл её фичу.
 */
export function useLiveMarketplaces(): LiveMarketplaces {
  const auth = useAuthStore();
  const sections = computed(() => auth.me?.sections ?? null);
  return {
    live: computed(() => liveMarketplaces(sections.value)),
    upcoming: computed(() => upcomingMarketplaces(sections.value)),
    isLive: (mp) => isLiveMarketplace(mp, sections.value),
    homeOf: (mp) => marketplaceHome(mp, sections.value),
  };
}
