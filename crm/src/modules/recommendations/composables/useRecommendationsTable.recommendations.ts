import type {
  CompetitivenessFilter,
  RecommendationRow,
  RecommendationSortKey,
  SortDir,
} from '../recommendations.domain';
import type { Ref } from 'vue';

import { computed, ref, watch } from 'vue';

import { filterRows, nextSort, sortRows } from '../mappers/recommendationsTable.recommendations';

/** Сколько строк рисовать за раз: на тысячах строк таблица иначе подвисает. */
export const PAGE_ROWS = 100;

/** Поиск, фильтр по оценке, сортировка и постраничный показ поверх строк среза. */
export function useRecommendationsTable(rows: Ref<readonly RecommendationRow[]>) {
  const query = ref('');
  const competitiveness = ref<CompetitivenessFilter>('all');
  // Как в боте и книге: сильнее всего выше привлекательной — сверху.
  const sort = ref<{ key: RecommendationSortKey; dir: SortDir }>({ key: 'deltaAbs', dir: 'desc' });
  const limit = ref(PAGE_ROWS);

  const matched = computed(() =>
    sortRows(
      filterRows(rows.value, query.value, competitiveness.value),
      sort.value.key,
      sort.value.dir,
    ),
  );
  const visible = computed(() => matched.value.slice(0, limit.value));
  const hidden = computed(() => Math.max(matched.value.length - limit.value, 0));

  function toggleSort(key: RecommendationSortKey): void {
    sort.value = nextSort(sort.value, key);
  }

  function showMore(): void {
    limit.value += PAGE_ROWS;
  }

  watch([rows, query, competitiveness], () => {
    limit.value = PAGE_ROWS;
  });

  return { query, competitiveness, sort, matched, visible, hidden, toggleSort, showMore };
}
