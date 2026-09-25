import type { TileMeta } from '../dashboard.domain';
import type { NavItem } from '@/navigation';

import { computed } from 'vue';

import { DASHBOARD_ROUTE_NAME, TILES } from '../dashboard.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useStoresStore } from '@/modules/stores/store/store.stores';
import { STORE_NAV, visibleNav } from '@/navigation';

/** Плитки, открытые продавцу: у каждой своя фича (довод openReports). */
export function openTiles(features: Record<string, boolean> | undefined): TileMeta[] {
  return TILES.filter((meta) => features?.[meta.feature] === true);
}

/** Быстрые ссылки — разделы открытого магазина, кроме самой главной. */
export function quickLinks(sections: string[] | null): NavItem[] {
  return visibleNav(STORE_NAV, sections).filter((item) => item.name !== DASHBOARD_ROUTE_NAME);
}

/**
 * Что показывать на главной магазина: фичи — из `/auth/me`, разделы — из вида
 * открытого магазина (по его модели). До обоих ответов `ready` ложно.
 */
export function useDashboardTiles() {
  const auth = useAuthStore();
  const stores = useStoresStore();

  const sections = computed(() => stores.current?.sections ?? null);
  const ready = computed(() => auth.me !== null && sections.value !== null);
  const tiles = computed(() => openTiles(auth.me?.features));
  const links = computed(() => quickLinks(sections.value));
  const priceListOpen = computed(() => sections.value?.includes('ym-price-list') === true);

  return { ready, tiles, links, priceListOpen };
}
