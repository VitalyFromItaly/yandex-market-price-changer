import type { OrderRow, OrderRowType, ReturnTab } from '../orders.domain';
import type { Ref } from 'vue';

import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { applyReturnsFilter, returnTabOptions, statusOptions } from '../mappers/ordersTable.orders';

/** Параметр query с вкладкой кабинета: путь уже занят вкладкой отчёта (`:report?`). */
export const RETURN_TAB_QUERY = 'rt';

/**
 * Фильтры реестра «Едет обратно» — как в кабинете ЯМ: вкладка (в URL), статус и тип.
 * Строки и подписи вкладок приходят с сервера; здесь только отбор и счётчики.
 */
export function useReturnsFilters(rows: Ref<readonly OrderRow[]>, tabs: Ref<readonly ReturnTab[]>) {
  const route = useRoute();
  const router = useRouter();

  const status = ref<string | null>(null);
  const type = ref<OrderRowType | null>(null);

  const tab = computed<string | null>({
    get: () => {
      const value = route.query[RETURN_TAB_QUERY];
      return typeof value === 'string' && tabs.value.some((t) => t.key === value) ? value : null;
    },
    set: (next) => {
      const query = { ...route.query };
      if (next === null) delete query[RETURN_TAB_QUERY];
      else query[RETURN_TAB_QUERY] = next;
      void router.replace({ query });
    },
  });

  const statuses = computed(() => statusOptions(rows.value));
  // Статус, которого в новом отчёте нет, — не фильтр, а пустая таблица без объяснения.
  watch(statuses, (next) => {
    if (status.value !== null && !next.includes(status.value)) status.value = null;
  });

  const options = computed(() =>
    returnTabOptions(rows.value, tabs.value, { status: status.value, type: type.value }),
  );
  const filtered = computed(() =>
    applyReturnsFilter(rows.value, { tab: tab.value, status: status.value, type: type.value }),
  );
  const active = computed(() => tab.value !== null || status.value !== null || type.value !== null);

  function clear(): void {
    status.value = null;
    type.value = null;
    tab.value = null;
  }

  return { tab, status, type, statuses, options, filtered, active, clear };
}
