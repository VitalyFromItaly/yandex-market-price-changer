import type { CardRow, CardsFilter, CardSortKey, SortDir } from '../offer-cards.domain';

/** Поиск по артикулу без регистра и фильтр «требуют действий / остальные». */
export function filterRows(
  rows: readonly CardRow[],
  query: string,
  filter: CardsFilter,
): CardRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filter === 'all' || row.actionable === (filter === 'actionable')) &&
      (needle === '' || row.offerId.toLowerCase().includes(needle)),
  );
}

/**
 * Стабильная сортировка. Карточка без рейтинга (Маркет его пересчитывает) — в
 * конце в любом направлении, как в книге бота.
 */
export function sortRows(rows: readonly CardRow[], key: CardSortKey, dir: SortDir): CardRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'offerId') return a.offerId.localeCompare(b.offerId, 'ru') * sign;
    if (key === 'status') return a.statusLabel.localeCompare(b.statusLabel, 'ru') * sign;
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return (left - right) * sign;
  });
}

/** Повторный клик меняет направление; рейтинг, артикул и статус — по возрастанию, счётчики — по убыванию. */
export function nextSort(
  current: { key: CardSortKey; dir: SortDir },
  key: CardSortKey,
): { key: CardSortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  const descending = key === 'errorsCount' || key === 'warningsCount';
  return { key, dir: descending ? 'desc' : 'asc' };
}
