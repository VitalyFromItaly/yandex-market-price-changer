import type { CardRow, CardsFilter, CardSortKey, SortDir } from '../offer-cards.domain';
import type { Ref } from 'vue';

import { computed, ref, watch } from 'vue';

import { filterRows, nextSort, sortRows } from '../mappers/cardsTable.offer-cards';

/** Сколько строк рисовать за раз: на тысячах строк таблица иначе подвисает. */
export const PAGE_ROWS = 100;

/** Поиск, фильтр, сортировка и постраничный показ поверх карточек среза. */
export function useCardsTable(rows: Ref<readonly CardRow[]>) {
  const query = ref('');
  const filter = ref<CardsFilter>('all');
  // Как в боте и книге: худшие по рейтингу — сверху.
  const sort = ref<{ key: CardSortKey; dir: SortDir }>({ key: 'contentRating', dir: 'asc' });
  const limit = ref(PAGE_ROWS);

  const matched = computed(() =>
    sortRows(filterRows(rows.value, query.value, filter.value), sort.value.key, sort.value.dir),
  );
  const visible = computed(() => matched.value.slice(0, limit.value));
  const hidden = computed(() => Math.max(matched.value.length - limit.value, 0));

  function toggleSort(key: CardSortKey): void {
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
