import type { UnitEconomicsResponse, UnitSku } from '../unit-economics.domain';

import { describe, expect, it } from 'vitest';

import {
  filterSkus,
  formatDelta,
  formatShare,
  toUnitRow,
  unconfirmedNote,
  unitCardLines,
  unitPlatforms,
} from './mapUnitEconomics.unit-economics';

function sku(over: Partial<UnitSku> = {}): UnitSku {
  return {
    sku: 'A1',
    name: 'Часы Casio',
    scheme: 'FBS',
    units: 2,
    orders: 2,
    costKnown: true,
    columns: {
      revenue: 1_000_000,
      otherIncome: 0,
      commission: -230_000,
      logistics: -50_000,
      promotion: -10_000,
      otherServices: 0,
      unrecognized: 0,
    },
    cogsKopecks: 400_000,
    taxKopecks: 60_000,
    netKopecks: 250_000,
    avgPriceKopecks: 500_000,
    unitCostKopecks: 200_000,
    unitNetKopecks: 125_000,
    margin: 0.25,
    shares: {
      commission: 0.23,
      logistics: 0.05,
      promotion: 0.01,
      otherServices: 0,
      cogs: 0.4,
      tax: 0.06,
    },
    minPriceKopecks: 320_000,
    previous: { revenueKopecks: 500_000, netKopecks: 100_000, units: 1, margin: 0.2 },
    schemes: [],
    ...over,
  };
}

describe('строка таблицы', () => {
  it('название сверху, артикул под ним; изменение к прошлому со знаком', () => {
    const row = toUnitRow(sku());
    expect(row).toMatchObject({
      title: 'Часы Casio',
      subtitle: 'A1',
      netTone: 'ok',
      deltaTone: 'ok',
    });
    expect(row.delta?.startsWith('+')).toBe(true);
    expect(row.margin).toBe(formatShare(0.25));
  });

  it('без названия — артикул заголовком; без прошлого — изменения нет', () => {
    const row = toUnitRow(sku({ name: null, previous: null }));
    expect(row).toMatchObject({ title: 'A1', subtitle: null, delta: null, deltaTone: 'muted' });
  });

  it('без себестоимости прибыль — верхняя граница «≤»', () => {
    expect(toUnitRow(sku({ costKnown: false })).net.startsWith('≤')).toBe(true);
  });
});

describe('поиск и сортировка', () => {
  const list = [
    sku({
      sku: 'A1',
      name: 'Часы Casio',
      netKopecks: 10,
      margin: 0.5,
      columns: { ...sku().columns, revenue: 100 },
    }),
    sku({
      sku: 'B2',
      name: 'Ремешок',
      netKopecks: 30,
      margin: null,
      columns: { ...sku().columns, revenue: 300 },
    }),
    sku({
      sku: 'C3',
      name: null,
      netKopecks: 20,
      margin: 0.1,
      columns: { ...sku().columns, revenue: 200 },
    }),
  ];

  it('по выручке, прибыли и рентабельности — по убыванию, без маржи — в конце', () => {
    expect(filterSkus(list, '', 'revenue').map((s) => s.sku)).toEqual(['B2', 'C3', 'A1']);
    expect(filterSkus(list, '', 'net').map((s) => s.sku)).toEqual(['B2', 'C3', 'A1']);
    expect(filterSkus(list, '', 'margin').map((s) => s.sku)).toEqual(['A1', 'C3', 'B2']);
  });

  it('поиск без регистра по названию и артикулу', () => {
    expect(filterSkus(list, 'ЧАСЫ', 'revenue').map((s) => s.sku)).toEqual(['A1']);
    expect(filterSkus(list, 'c3', 'revenue').map((s) => s.sku)).toEqual(['C3']);
  });
});

describe('карточка товара', () => {
  it('расходы положительными суммами, итог и минимальная цена есть', () => {
    const lines = unitCardLines(sku());
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]));
    expect(byLabel['Комиссия и эквайринг']?.ym).not.toContain('-');
    expect(byLabel['Прибыль за период']?.strong).toBe(true);
    expect(byLabel['Минимальная цена без убытка']).toBeDefined();
    expect(byLabel['Прибыль к прошлому периоду']?.ym).toBe(formatDelta(150_000));
  });

  it('нет закупа — себестоимость «не подтверждено», красным', () => {
    const line = unitCardLines(sku({ costKnown: false })).find((l) => l.label === 'Себестоимость');
    expect(line?.ym).toContain('не подтверждено');
    expect(line?.tone).toBe('danger');
  });
});

describe('признак «прибыль не подтверждена»', () => {
  const view = (unconfirmed: UnitEconomicsResponse['unconfirmed']) =>
    ({ unconfirmed }) as UnitEconomicsResponse;

  it('печатается из ответа: число заказов и сумма', () => {
    expect(
      unconfirmedNote(view({ confirmed: false, orders: 1, revenueKopecks: 10_000, skus: ['A'] })),
    ).toMatch(/^Прибыль не подтверждена: 1 заказ на 100\s₽ — нет закупа на дату продажи\./);
  });

  it('подтверждённая прибыль — без плашки', () => {
    expect(
      unconfirmedNote(view({ confirmed: true, orders: 0, revenueKopecks: 0, skus: [] })),
    ).toBeNull();
  });
});

describe('колонки карточки по площадке (TASK-181)', () => {
  it('ЯМ — числа у Маркета, Ozon и WB «скоро»; Ozon — только своя колонка с числами', () => {
    expect(unitPlatforms('ym').map((p) => [p.key, p.ready])).toEqual([
      ['ym', true],
      ['ozon', false],
      ['wb', false],
    ]);
    expect(unitPlatforms('ozon')).toEqual([{ key: 'ozon', label: 'Ozon', ready: true }]);
    expect(unitPlatforms('wb').map((p) => p.label)).toEqual(['Wildberries']);
  });
});
