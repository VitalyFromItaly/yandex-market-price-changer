import type {
  AccountingMarketplace,
  AccountingOrdersRequest,
  OrderProfitState,
} from '../accounting.domain';

import { computed, ref } from 'vue';

import { monthLabel, moscowTodayIso, recentMonths } from '@/shared/period';

export interface OrdersStoreOption {
  key: string;
  label: string;
}

/** «Все» в выборе площадки и состояния — пустой ключ, в запрос уходит null. */
export const ALL_OPTION = '';

/**
 * Выбор секции заказов «Финучёта» (TASK-223): магазин (страница — уровня аккаунта,
 * а задачи — магазинные; решение `accounting_orders_store_picker`), месяц оформления
 * (текущий включительно — его заказы и нужны), площадка, состояние, «только убыточные».
 * Магазин — из списка «Магазинов» по имени; ключ — хэш, campaign_id не виден.
 */
export function useAccountingOrdersFilters(
  stores: () => OrdersStoreOption[],
  today: string = moscowTodayIso(),
) {
  const monthOptions = recentMonths(today, 13).map((value) => ({
    value,
    label: monthLabel(value),
  }));
  const month = ref<string>(monthOptions[0]?.value ?? today.slice(0, 7));
  const monthTitle = computed(
    () => monthOptions.find((o) => o.value === month.value)?.label ?? month.value,
  );

  const picked = ref<string | null>(null);
  /** Выбранный магазин; нет выбора — первый из списка. Пропал из списка — тоже первый. */
  const store = computed<OrdersStoreOption | null>(() => {
    const list = stores();
    return list.find((s) => s.key === picked.value) ?? list[0] ?? null;
  });
  function selectStore(key: string): void {
    picked.value = key;
  }

  const marketplace = ref<string>(ALL_OPTION);
  const state = ref<string>(ALL_OPTION);
  const lossOnly = ref(false);

  /** Запрос задачи; null — магазина нет, ставить нечего. */
  const request = computed<AccountingOrdersRequest | null>(() =>
    store.value === null
      ? null
      : {
          store: store.value.key,
          month: month.value,
          marketplace: (marketplace.value || null) as AccountingMarketplace | null,
          state: (state.value || null) as OrderProfitState | null,
          lossOnly: lossOnly.value,
        },
  );

  function resetFilter(): void {
    marketplace.value = ALL_OPTION;
    state.value = ALL_OPTION;
    lossOnly.value = false;
  }

  return {
    month,
    monthOptions,
    monthTitle,
    store,
    selectStore,
    marketplace,
    state,
    lossOnly,
    request,
    filtered: computed(() => Boolean(marketplace.value || state.value || lossOnly.value)),
    resetFilter,
  };
}
