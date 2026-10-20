import type { ComputedRef } from 'vue';

import { computed } from 'vue';
import { useRoute } from 'vue-router';

/**
 * Ключ магазина из адреса (`/ym/stores/:store/...`). Разделы внутри магазина
 * отдают его с каждым запросом отчёта: активный магазин бота веб не читает.
 * Пустая строка — страница открыта вне магазина.
 */
export function useStoreKey(): ComputedRef<string> {
  const route = useRoute();
  return computed(() => {
    const value: unknown = route.params.store;
    return typeof value === 'string' ? value : '';
  });
}
