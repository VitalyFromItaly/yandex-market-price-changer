import type { KpiMeta, OrderRowMeta, SourceKey, SourceMeta } from '../dashboard.domain';
import type { NavItem } from '@/navigation';

import { computed } from 'vue';

import { DASHBOARD_ROUTE_NAME, KPIS, ORDER_ROWS, SOURCES } from '../dashboard.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useStoresStore } from '@/modules/stores/store/store.stores';
import { STORE_NAV, visibleNav } from '@/navigation';

/**
 * Источники, открытые продавцу: по фиче из `/auth/me` или по разделу из вида
 * магазина (FBY — фича плюс модель магазина, решает сервер).
 */
export function openSources(
  features: Record<string, boolean> | undefined,
  sections: readonly string[] | null,
): SourceMeta[] {
  return SOURCES.filter((meta) =>
    'feature' in meta.open
      ? features?.[meta.open.feature] === true
      : sections?.includes(meta.open.section) === true,
  );
}

/** Карточки открытых источников — в порядке ряда. */
export function openKpis(open: readonly SourceKey[]): KpiMeta[] {
  return KPIS.filter((meta) => open.includes(meta.source));
}

/** Строки блока «Заказы» открытых источников: закрытая фича — строки нет. */
export function openOrderRows(open: readonly SourceKey[]): OrderRowMeta[] {
  return ORDER_ROWS.filter((meta) => open.includes(meta.source));
}

/** Быстрые ссылки — разделы открытого магазина, кроме самой главной. */
export function quickLinks(sections: string[] | null): NavItem[] {
  return visibleNav(STORE_NAV, sections).filter((item) => item.name !== DASHBOARD_ROUTE_NAME);
}

/**
 * Что показывать на главной магазина: фичи — из `/auth/me`, разделы — из вида
 * открытого магазина (по его модели). До обоих ответов `ready` ложно.
 */
export function useDashboardKpis() {
  const auth = useAuthStore();
  const stores = useStoresStore();

  const sections = computed(() => stores.current?.sections ?? null);
  const ready = computed(() => auth.me !== null && sections.value !== null);
  const sources = computed(() =>
    openSources(auth.me?.features, sections.value).map((meta) => meta.key),
  );
  const kpis = computed(() => openKpis(sources.value));
  const orderRows = computed(() => openOrderRows(sources.value));
  const links = computed(() => quickLinks(sections.value));
  const priceListOpen = computed(() => sections.value?.includes('ym-price-list') === true);
  const fbyOpen = computed(() => sections.value?.includes('ym-fby') === true);
  const ordersOpen = computed(() => sections.value?.includes('ym-orders') === true);

  return { ready, sources, kpis, orderRows, links, priceListOpen, fbyOpen, ordersOpen };
}
