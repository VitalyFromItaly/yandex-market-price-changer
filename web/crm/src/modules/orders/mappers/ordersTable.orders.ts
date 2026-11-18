import type { OrderRow, ReturnTab, ReturnsFilter, SortDir, SortKey } from '../orders.domain';

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

// --- реестр «Едет обратно»: фильтры как в кабинете ЯМ ---------------------------

/** Строки под фильтром «Едет обратно»; `null` в поле — «все». */
export function applyReturnsFilter(rows: readonly OrderRow[], filter: ReturnsFilter): OrderRow[] {
  return rows.filter(
    (row) =>
      (filter.tab === null || row.tab === filter.tab) &&
      (filter.status === null || row.statusLabel === filter.status) &&
      (filter.type === null || row.type === filter.type),
  );
}

/**
 * Вкладки со счётчиками по строкам под фильтрами статуса и типа (без фильтра вкладки) —
 * как кабинет пересчитывает вкладки под выбранными фильтрами. «Все» — последней, как там.
 */
export function returnTabOptions(
  rows: readonly OrderRow[],
  tabs: readonly ReturnTab[],
  filter: Omit<ReturnsFilter, 'tab'>,
): Array<{ key: string | null; label: string; count: number }> {
  const scoped = applyReturnsFilter(rows, { ...filter, tab: null });
  return [
    ...tabs.map((tab) => ({
      key: tab.key,
      label: tab.label,
      count: scoped.filter((row) => row.tab === tab.key).length,
    })),
    { key: null, label: 'Все', count: scoped.length },
  ];
}

/** Статусы, реально встретившиеся в строках, — по алфавиту. */
export function statusOptions(rows: readonly OrderRow[]): string[] {
  return [...new Set(rows.map((row) => row.statusLabel).filter((label) => label !== ''))].sort(
    (a, b) => a.localeCompare(b, 'ru'),
  );
}
