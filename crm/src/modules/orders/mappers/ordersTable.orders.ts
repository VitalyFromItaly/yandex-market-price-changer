import type { OrderRow, SortDir, SortKey } from '../orders.domain';

/**
 * Поиск по номеру заказа, составу (название, артикул) и статусу — без регистра.
 * `day` (ГГГГММДД) — день, выбранный на графике; `null` — все дни.
 */
export function filterRows(
  rows: readonly OrderRow[],
  query: string,
  day: number | null = null,
): OrderRow[] {
  const needle = query.trim().toLowerCase();
  const ofDay = day === null ? rows : rows.filter((row) => row.dateSort === day);
  if (needle === '') return [...ofDay];
  return ofDay.filter((row) =>
    [String(row.orderId ?? ''), row.items, row.statusLabel, row.typeLabel].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

function sortValue(row: OrderRow, key: SortKey): number | string {
  switch (key) {
    case 'orderId':
      return row.orderId ?? -1;
    case 'date':
      return row.dateSort;
    case 'status':
      return row.statusLabel;
    default:
      return row[key];
  }
}

/** Стабильная сортировка: при равенстве сохраняется порядок отчёта. */
export function sortRows(rows: readonly OrderRow[], key: SortKey, dir: SortDir): OrderRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (typeof left === 'string' && typeof right === 'string') {
      return left.localeCompare(right, 'ru') * sign;
    }
    return (Number(left) - Number(right)) * sign;
  });
}

/** Повторный клик по активной колонке меняет направление; новая колонка — деньги и даты по убыванию. */
export function nextSort(
  current: { key: SortKey; dir: SortDir },
  key: SortKey,
): { key: SortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'status' ? 'asc' : 'desc' };
}
