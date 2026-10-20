import type { InventoryFilter, InventoryRow, InventorySortKey, SortDir } from '../inventory.domain';
import type { Ref } from 'vue';

import { computed, ref, watch } from 'vue';

import { filterRows, nextSort, sortRows } from '../mappers/inventoryTable.inventory';

/** Сколько строк рисовать за раз: товаров бывают тысячи. */
export const PAGE_ROWS = 100;

/** Поиск, фильтр, сортировка и показ порциями поверх строк склада. */
export function useInventoryTable(rows: Ref<readonly InventoryRow[]>, lowDays: Ref<number>) {
  const query = ref('');
  const filter = ref<InventoryFilter>('all');
  // Как сервер: что кончится раньше — сверху.
  const sort = ref<{ key: InventorySortKey; dir: SortDir }>({ key: 'daysLeft', dir: 'asc' });
  const limit = ref(PAGE_ROWS);

  const matched = computed(() =>
    sortRows(
      filterRows(rows.value, query.value, filter.value, lowDays.value),
      sort.value.key,
      sort.value.dir,
    ),
  );
  const visible = computed(() => matched.value.slice(0, limit.value));
  const hidden = computed(() => Math.max(matched.value.length - limit.value, 0));

  function toggleSort(key: InventorySortKey): void {
    sort.value = nextSort(sort.value, key);
  }

  function showMore(): void {
    limit.value += PAGE_ROWS;
  }

  watch([rows, query, filter], () => {
    limit.value = PAGE_ROWS;
  });

  return { query, filter, sort, matched, visible, hidden, toggleSort, showMore };
}
