import type { OrderRow, SortDir, SortKey } from '../orders.domain';
import type { Ref } from 'vue';

import { computed, ref, watch } from 'vue';

import { filterRows, nextSort, sortRows } from '../mappers/ordersTable.orders';

/** Сколько строк рисовать за раз: на тысячах строк таблица иначе подвисает. */
export const PAGE_ROWS = 100;

/** Поиск, сортировка и постраничный показ поверх строк отчёта. */
export function useOrdersTable(rows: Ref<readonly OrderRow[]>, day: Ref<string | null>) {
  const query = ref('');
  const sort = ref<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const limit = ref(PAGE_ROWS);

  const matched = computed(() =>
    sortRows(
      filterRows(rows.value, query.value, day.value === null ? null : Number(day.value)),
      sort.value.key,
      sort.value.dir,
    ),
  );
  const visible = computed(() => matched.value.slice(0, limit.value));
  const hidden = computed(() => Math.max(matched.value.length - limit.value, 0));

  function toggleSort(key: SortKey): void {
    sort.value = nextSort(sort.value, key);
  }

  function showMore(): void {
    limit.value += PAGE_ROWS;
  }

  // Новый отчёт или новый поиск — снова с первой страницы.
  watch([rows, query, day], () => {
    limit.value = PAGE_ROWS;
  });

  return { query, sort, matched, visible, hidden, toggleSort, showMore };
}
