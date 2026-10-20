import type {
  InventoryAmount,
  InventoryFilter,
  InventoryRow,
  InventorySortKey,
  SortDir,
} from '../inventory.domain';

import { formatCount } from '@/shared/utils';

/** Заканчивается: продаётся и хватит меньше чем на порог сервера. */
export function isLow(row: InventoryRow, lowDays: number): boolean {
  return row.daysLeft !== null && row.daysLeft < lowDays;
}

/** Поиск по артикулу и названию без регистра плюс фильтр. Порог — из ответа сервера. */
export function filterRows(
  rows: readonly InventoryRow[],
  query: string,
  filter: InventoryFilter,
  lowDays: number,
): InventoryRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === 'low' && !isLow(row, lowDays)) return false;
    if (filter === 'no-cost' && row.costKopecks !== null) return false;
    if (needle === '') return true;
    return (
      row.internalSku.toLowerCase().includes(needle) ||
      (row.name ?? '').toLowerCase().includes(needle)
    );
  });
}

/** Стабильная сортировка; «нет данных» — в конце в любом направлении. */
export function sortRows(
  rows: readonly InventoryRow[],
  key: InventorySortKey,
  dir: SortDir,
): InventoryRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name') {
      return (a.name ?? a.internalSku).localeCompare(b.name ?? b.internalSku, 'ru') * sign;
    }
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return (left - right) * sign;
  });
}

/** Повторный клик меняет направление; дни запаса и название — по возрастанию, количества — по убыванию. */
export function nextSort(
  current: { key: InventorySortKey; dir: SortDir },
  key: InventorySortKey,
): { key: InventorySortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'daysLeft' || key === 'name' ? 'asc' : 'desc' };
}

/** «12» или «12 · резерв 3»; нет данных — «—». */
export function amountLabel(amount: InventoryAmount | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const base = formatCount(amount.available);
  return amount.reserved ? `${base} · резерв ${formatCount(amount.reserved)}` : base;
}

export function countLabel(value: number | null): string {
  return value === null ? '—' : formatCount(value);
}

export function speedLabel(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
