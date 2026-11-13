import type { OrdersStoreOption } from './useAccountingOrdersFilters.accounting';
import type {
  AccountingAnalyticsRequest,
  AccountingDashboardRequest,
  AccountingMarketplace,
  DashboardBasis,
  DashboardFilter,
} from '../accounting.domain';
import type { RangePreset } from '@/shared/period';
import type { DayRange } from '@/shared/utils';

import { computed, ref } from 'vue';

import { ALL_OPTION } from './useAccountingOrdersFilters.accounting';

import { isValidRange, moscowTodayIso, rangeOf } from '@/shared/period';

/** Потолок артикула и номера заказа — как у сервера (`MAX_REF_LENGTH`). */
export const DASHBOARD_REF_MAX = 100;

const refOf = (value: string): string | null => {
  const trimmed = value.trim().slice(0, DASHBOARD_REF_MAX);
  return trimmed === '' ? null : trimmed;
};

/**
 * Выбор панели «Финучёта» (TASK-231): магазин (страница уровня аккаунта, задачи —
 * магазинные), базис (по умолчанию — дата продажи), период диапазоном (пресет пикера
 * или свои даты; по умолчанию — этот месяц), площадка и бренд — сразу, артикул и номер
 * заказа — по «Применить» (иначе задача ставилась бы на каждую букву).
 */
export function useAccountingDashboardFilters(
  stores: () => OrdersStoreOption[],
  today: string = moscowTodayIso(),
) {
  const picked = ref<string | null>(null);
  const store = computed<OrdersStoreOption | null>(() => {
    const list = stores();
    return list.find((s) => s.key === picked.value) ?? list[0] ?? null;
  });
  function selectStore(key: string): void {
    picked.value = key;
  }

  const basis = ref<DashboardBasis>('sale');

  const preset = ref<RangePreset>('month');
  const custom = ref<DayRange | null>(null);
  const range = computed<DayRange | null>(() => {
    const next = preset.value === 'custom' ? custom.value : rangeOf(preset.value, today);
    return next && isValidRange(next, today) ? next : null;
  });
  function choosePreset(next: RangePreset): void {
    preset.value = next;
    if (next === 'custom' && custom.value === null) custom.value = rangeOf('month', today);
  }
  function chooseCustom(next: DayRange): void {
    custom.value = next;
    preset.value = 'custom';
  }

  const marketplace = ref<string>(ALL_OPTION);
  const brand = ref<string>(ALL_OPTION);
  const offerDraft = ref('');
  const orderDraft = ref('');
  const offerId = ref<string | null>(null);
  const orderId = ref<string | null>(null);
  function applyRefs(): void {
    offerId.value = refOf(offerDraft.value);
    orderId.value = refOf(orderDraft.value);
  }

  const filter = computed<DashboardFilter>(() => ({
    marketplace: (marketplace.value || null) as AccountingMarketplace | null,
    brand: brand.value || null,
    offerId: offerId.value,
    orderId: orderId.value,
  }));
  const filtered = computed(() => Object.values(filter.value).some((v) => v !== null));

  function resetFilter(): void {
    marketplace.value = ALL_OPTION;
    brand.value = ALL_OPTION;
    offerDraft.value = '';
    orderDraft.value = '';
    offerId.value = null;
    orderId.value = null;
  }

  /** Запрос панели; null — нет магазина или период непригоден. */
  const dashboardRequest = computed<AccountingDashboardRequest | null>(() =>
    store.value === null || range.value === null
      ? null
      : { store: store.value.key, basis: basis.value, range: range.value, filter: filter.value },
  );
  /** Аналитика — по заказам периода: без базиса и фильтра. */
  const analyticsRequest = computed<AccountingAnalyticsRequest | null>(() =>
    store.value === null || range.value === null
      ? null
      : { store: store.value.key, range: range.value },
  );

  return {
    store,
    selectStore,
    basis,
    preset,
    custom,
    range,
    choosePreset,
    chooseCustom,
    marketplace,
    brand,
    offerDraft,
    orderDraft,
    applyRefs,
    filter,
    filtered,
    resetFilter,
    dashboardRequest,
    analyticsRequest,
  };
}
