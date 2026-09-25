import type { StockTotals, WarehouseRowResponse, WarehousesResponse } from '../warehouses.domain';

import { describe, expect, it } from 'vitest';

import { mapWarehouses } from './mapWarehouses.warehouses';
import { filterWarehouses } from './warehousesTable.warehouses';

const zero: StockTotals = {
  AVAILABLE: 0,
  FIT: 0,
  FREEZE: 0,
  QUARANTINE: 0,
  DEFECT: 0,
  EXPIRED: 0,
  UTILIZATION: 0,
};

function row(name: string, count: number, overrides: Partial<WarehouseRowResponse> = {}) {
  return {
    key: name.toLowerCase(),
    name,
    address: null,
    ids: [1],
    origin: 'matched' as const,
    totals: { ...zero, AVAILABLE: count },
    count,
    ...overrides,
  };
}

const ROWS: WarehouseRowResponse[] = [
  row('Ростов-на-Дону-1', 10, { address: 'ул. Складская' }),
  row('Софьино', 0),
  row('Призрак', 3, { origin: 'report-only', ids: [] }),
];

describe('filterWarehouses', () => {
  it('фильтр по остаткам и поиск по названию и адресу', () => {
    expect(filterWarehouses(ROWS, '', 'stocked').map((r) => r.name)).toEqual([
      'Ростов-на-Дону-1',
      'Призрак',
    ]);
    expect(filterWarehouses(ROWS, '', 'empty').map((r) => r.name)).toEqual(['Софьино']);
    expect(filterWarehouses(ROWS, 'складская', 'all').map((r) => r.name)).toEqual([
      'Ростов-на-Дону-1',
    ]);
  });

  it('без отчёта «пустых» нет: не знаем ≠ ноль', () => {
    const unknown = ROWS.map((r) => ({ ...r, totals: null }));
    expect(filterWarehouses(unknown, '', 'empty')).toEqual([]);
    expect(filterWarehouses(unknown, '', 'all')).toHaveLength(3);
  });
});

describe('mapWarehouses', () => {
  const response: WarehousesResponse = {
    takenAt: '24-09-2026 10:05',
    stockTakenAt: '24-09-2026 10:04',
    stockTypes: [
      { type: 'AVAILABLE', label: 'доступно' },
      { type: 'FREEZE', label: 'резерв' },
      { type: 'DEFECT', label: 'брак' },
    ],
    stockProblem: null,
    fbyHint: 'Товар хранит и отгружает Маркет.',
    storeHint: 'Ваши склады отгрузки (FBS/DBS/Экспресс).',
    notInListLabel: 'нет в списке складов Маркета',
    fby: ROWS,
    sum: { ...zero, AVAILABLE: 13, FREEZE: 2 },
    store: [],
    emptyText: null,
  };

  it('колонки — по сумме: «доступно» всегда, остальные ненулевые', () => {
    const report = mapWarehouses(response);
    expect(report.columns.map((c) => c.type)).toEqual(['AVAILABLE', 'FREEZE']);
    expect(report.heading).toBe('на 24-09-2026 10:05 МСК');
  });

  it('отчёта нет — колонок остатков нет', () => {
    expect(mapWarehouses({ ...response, sum: null, stockTakenAt: null }).columns).toEqual([]);
  });
});
