import type { TaxesTabMeta } from '../taxes.domain';

import { computed } from 'vue';

import { TAX_YEAR_FEATURE, TAXES_ROUTE_NAME } from '../taxes.domain';

import { useAuthStore } from '@/modules/auth/store/store.auth';
import { useRouteTabs } from '@/shared/composables';

export const TAXES_TABS: readonly TaxesTabMeta[] = [
  { key: 'settings', label: 'Настройки' },
  { key: 'year', label: 'Год', feature: TAX_YEAR_FEATURE },
];

/**
 * Вкладки, открытые продавцу. Раздел открывает `taxes`; «Год» — ещё и
 * `tax_year` (в снимке `features` уже с учётом её `requires`), закрытая вела бы
 * в 403.
 */
export function openTaxesTabs(features: Record<string, boolean> | undefined): TaxesTabMeta[] {
  return TAXES_TABS.filter((tab) => !tab.feature || features?.[tab.feature] === true);
}

/** Вкладка — в URL (`/ym/taxes/:tab?`): F5 возвращает в ту же. */
export function useTaxesTabs() {
  const auth = useAuthStore();
  const open = computed(() => openTaxesTabs(auth.me?.features));
  return { open, ...useRouteTabs(TAXES_ROUTE_NAME, 'tab', open) };
}
