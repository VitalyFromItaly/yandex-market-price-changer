import type { WarehousesReport, WarehousesResponse } from '../warehouses.domain';

export function mapWarehouses(response: WarehousesResponse): WarehousesReport {
  const { sum } = response;
  return {
    heading: `на ${response.takenAt} МСК`,
    stockHeading: response.stockTakenAt
      ? `Остатки — из отчёта Маркета на ${response.stockTakenAt} МСК`
      : null,
    stockProblem: response.stockProblem,
    fbyHint: response.fbyHint,
    storeHint: response.storeHint,
    notInListLabel: response.notInListLabel,
    columns: sum
      ? response.stockTypes.filter(({ type }) => type === 'AVAILABLE' || sum[type] > 0)
      : [],
    rows: response.fby,
    sum,
    store: response.store,
    emptyText: response.emptyText,
  };
}
