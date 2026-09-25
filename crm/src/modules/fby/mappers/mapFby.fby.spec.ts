import type { FbyResponse, StockTotals } from '../fby.domain';

import { describe, expect, it } from 'vitest';

import { mapFby } from './mapFby.fby';
import { filterProblems } from './problemsTable.fby';

const zero: StockTotals = {
  AVAILABLE: 0,
  FIT: 0,
  FREEZE: 0,
  QUARANTINE: 0,
  DEFECT: 0,
  EXPIRED: 0,
  UTILIZATION: 0,
};

function response(overrides: Partial<FbyResponse> = {}): FbyResponse {
  return {
    takenAt: '24-09-2026 10:05',
    stockTakenAt: '24-09-2026 10:04',
    stockTypes: [
      { type: 'AVAILABLE', label: 'доступно' },
      { type: 'FREEZE', label: 'резерв' },
      { type: 'DEFECT', label: 'брак' },
    ],
    stockHint: 'Резерв — …',
    stockProblem: null,
    stock: {
      totals: { ...zero, AVAILABLE: 15, DEFECT: 2 },
      clusters: [
        {
          title: 'Москва',
          totals: { ...zero, AVAILABLE: 10, DEFECT: 2 },
          warehouses: [
            { name: 'Софьино', totals: { ...zero, AVAILABLE: 6, DEFECT: 2 } },
            { name: 'Томилино', totals: { ...zero, AVAILABLE: 4 } },
          ],
        },
        {
          title: 'Новый склад',
          totals: { ...zero, AVAILABLE: 5 },
          warehouses: [{ name: 'Новый склад', totals: { ...zero, AVAILABLE: 5 } }],
        },
      ],
      problems: [
        { sku: 'W-1', name: 'Часы Casio', defect: 2, expired: 0, utilization: 0 },
        { sku: 'X-9', name: 'Ремешок', defect: 1, expired: 0, utilization: 0 },
      ],
    },
    requests: [],
    requestsProblem: null,
    supplies: { state: 'off' },
    inTransit: 3,
    returning: null,
    file: { filename: 'fby-ostatki-24-09-2026-1005.xlsx', rows: 2, truncated: 0 },
    ...overrides,
  };
}

describe('mapFby', () => {
  it('кластер строкой, склады под ним; одиночный склад вне реестра — без повтора', () => {
    const report = mapFby(response());
    expect(report.heading).toBe('на 24-09-2026 10:05 МСК');
    expect(report.stockHeading).toBe('Остатки — из отчёта Маркета на 24-09-2026 10:04 МСК');
    expect(report.stock?.rows.map((row) => [row.title, row.nested])).toEqual([
      ['Москва', false],
      ['Софьино', true],
      ['Томилино', true],
      ['Новый склад', false],
    ]);
  });

  it('колонки — «доступно» всегда, остальные только ненулевые', () => {
    const report = mapFby(response());
    expect(report.stock?.columns.map((column) => column.type)).toEqual(['AVAILABLE', 'DEFECT']);
  });

  it('остатков нет — stock null, причина сохраняется', () => {
    const report = mapFby(
      response({ stock: null, stockTakenAt: null, stockProblem: 'Остатки временно недоступны.' }),
    );
    expect(report.stock).toBeNull();
    expect(report.stockHeading).toBeNull();
    expect(report.stockProblem).toBe('Остатки временно недоступны.');
  });
});

describe('filterProblems', () => {
  const problems = response().stock?.problems ?? [];

  it('ищет по артикулу и названию без учёта регистра', () => {
    expect(filterProblems(problems, 'casio').map((p) => p.sku)).toEqual(['W-1']);
    expect(filterProblems(problems, ' x-9 ').map((p) => p.sku)).toEqual(['X-9']);
    expect(filterProblems(problems, '')).toHaveLength(2);
  });
});
