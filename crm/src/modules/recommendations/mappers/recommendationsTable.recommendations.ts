import type {
  CompetitivenessFilter,
  RecommendationRow,
  RecommendationSortKey,
  SortDir,
} from '../recommendations.domain';

/** Поиск по артикулу без регистра и фильтр по оценке Маркета. */
export function filterRows(
  rows: readonly RecommendationRow[],
  query: string,
  competitiveness: CompetitivenessFilter,
): RecommendationRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (competitiveness === 'all' || row.competitiveness === competitiveness) &&
      (needle === '' || row.offerId.toLowerCase().includes(needle)),
  );
}

/**
 * Стабильная сортировка. Строки без значения (нет порога, нет показов) — всегда
 * в конце, в любом направлении: «нет данных» не дешевле и не дороже других.
 */
export function sortRows(
  rows: readonly RecommendationRow[],
  key: RecommendationSortKey,
  dir: SortDir,
): RecommendationRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'offerId') return a.offerId.localeCompare(b.offerId, 'ru') * sign;
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return (left - right) * sign;
  });
}

/** Повторный клик меняет направление; новая колонка — числа по убыванию, артикул по возрастанию. */
export function nextSort(
  current: { key: RecommendationSortKey; dir: SortDir },
  key: RecommendationSortKey,
): { key: RecommendationSortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'offerId' ? 'asc' : 'desc' };
}
