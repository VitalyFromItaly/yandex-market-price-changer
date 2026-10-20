import type { WarehouseRowResponse, WarehousesFilter } from '../warehouses.domain';

/**
 * Поиск по названию и адресу плюс фильтр по остаткам. Порядок — серверный
 * (непустые сверху, по количеству). Без отчёта (`totals: null`) «пустых» нет:
 * «не знаем» не равно «ноль».
 */
export function filterWarehouses(
  rows: readonly WarehouseRowResponse[],
  query: string,
  filter: WarehousesFilter,
): WarehouseRowResponse[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === 'stocked' && !(row.totals && row.count > 0)) return false;
    if (filter === 'empty' && !(row.totals && row.count === 0)) return false;
    if (needle === '') return true;
    return (
      row.name.toLowerCase().includes(needle) || (row.address ?? '').toLowerCase().includes(needle)
    );
  });
}
