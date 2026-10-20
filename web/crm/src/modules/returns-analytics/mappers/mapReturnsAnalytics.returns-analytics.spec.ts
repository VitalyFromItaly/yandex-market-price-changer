import type { ReturnFigures, ReturnSku, ReturnsMarketplace } from '../returns-analytics.domain';

import { describe, expect, it } from 'vitest';

import {
  filterReturnSkus,
  formatRate,
  isQuiet,
  kpisOf,
  marketplaceRows,
  restRow,
  skuRow,
} from './mapReturnsAnalytics.returns-analytics';

const figures = (over: Partial<ReturnFigures> = {}): ReturnFigures => ({
  returnedUnits: 0,
  returnedOrders: 0,
  soldUnits: 0,
  returnRate: null,
  returnedAmountKopecks: 0,
  reverseLogisticsKopecks: 0,
  withholdingsKopecks: 0,
  compensationsKopecks: 0,
  unreturnedCommissionKopecks: 0,
  lossesKopecks: 0,
  ...over,
});

const mp = (
  marketplace: string,
  label: string,
  over: Partial<ReturnFigures> = {},
): ReturnsMarketplace => ({
  marketplace,
  label,
  period: { from: '2026-09-01', to: '2026-09-30' },
  totals: figures(over),
  skus: [
    { sku: 'A1', name: 'Casio G-Shock', brand: 'casio', ...figures({ returnedUnits: 1 }) },
    { sku: 'B2', name: null, brand: null, ...figures({ returnedUnits: 2 }) },
  ],
  brands: [],
  rest: figures(),
});

describe('вид «Аналитики возвратов»', () => {
  it('процент — с сервера; без выкупов — прочерк, а не 0 %', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0.125)).toMatch(/^12,5\s?%$/);
  });

  it('KPI площадки: штуки с заказами, процент с выкупами, потери с разбивкой', () => {
    const kpis = kpisOf(
      mp('ym', 'Яндекс Маркет', {
        returnedUnits: 3,
        returnedOrders: 2,
        soldUnits: 30,
        returnRate: 0.1,
        lossesKopecks: 42_000,
      }),
    );
    expect(kpis.map((k) => k.key)).toEqual(['units', 'rate', 'amount', 'logistics', 'losses']);
    expect(kpis[0]?.caption).toBe('2 заказа');
    expect(kpis[1]?.caption).toBe('выкуплено 30 шт.');
    expect(kpis[4]?.value).toMatch(/^420\s₽$/);
  });

  it('площадки — по строке на каждую, без итога', () => {
    const rows = marketplaceRows([mp('ym', 'Яндекс Маркет'), mp('wb', 'Wildberries')]);
    expect(rows.map((r) => r.title)).toEqual(['Яндекс Маркет', 'Wildberries']);
  });

  it('товар без названия — артикулом; пустое «не отнесено» не показывается', () => {
    const data = mp('ym', 'Яндекс Маркет');
    const [named, unnamed] = data.skus as [ReturnSku, ReturnSku];
    expect(skuRow(unnamed).title).toBe('B2');
    expect(skuRow(named).subtitle).toBe('A1');
    expect(restRow(data)).toBeNull();
    expect(isQuiet(data)).toBe(true);
  });

  it('поиск по названию и артикулу, порядок сервера', () => {
    const { skus } = mp('ym', 'Яндекс Маркет');
    expect(filterReturnSkus(skus, 'casio').map((s) => s.sku)).toEqual(['A1']);
    expect(filterReturnSkus(skus, ' b2 ').map((s) => s.sku)).toEqual(['B2']);
    expect(filterReturnSkus(skus, '').map((s) => s.sku)).toEqual(['A1', 'B2']);
  });
});
