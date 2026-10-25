import type {
  CompareColumn,
  CompareMetrics,
  MarketplaceCompareResponse,
} from '../marketplace-compare.domain';

import { describe, expect, it } from 'vitest';

import {
  compareRows,
  costSharePoints,
  numberedColumns,
  revenueSegments,
  schemeRows,
  statusTone,
} from './mapCompare.marketplace-compare';

import { financeLink } from '@/shared/marketplaces';

const SEPT = { from: '2026-09-01', to: '2026-09-30' };

function metrics(over: Partial<CompareMetrics> = {}): CompareMetrics {
  return {
    revenueKopecks: 1_000_000,
    salesKopecks: 1_100_000,
    returnsKopecks: -100_000,
    returnsShare: 100_000 / 1_100_000,
    orders: 10,
    units: 12,
    avgCheckKopecks: 100_000,
    services: {
      commission: -150_000,
      logistics: -80_000,
      promotion: -20_000,
      withholdings: 0,
      otherServices: -5_000,
    },
    commissionShare: 0.15,
    marketplaceKopecks: -255_000,
    costShare: 0.255,
    cogsKopecks: 400_000,
    operatingExpensesKopecks: 30_000,
    taxKopecks: 60_000,
    netKopecks: 255_000,
    netMargin: 0.255,
    netPerOrderKopecks: 25_500,
    costComplete: true,
    ...over,
  };
}

function column(
  marketplace: CompareColumn['marketplace'],
  over: Partial<CompareColumn> = {},
): CompareColumn {
  return {
    marketplace,
    label: marketplace.toUpperCase(),
    state: 'ok',
    reason: null,
    status: 'preliminary',
    statusLabel: 'Предварительные данные',
    verified: false,
    metrics: metrics(),
    previous: null,
    schemes: [],
    ...over,
  };
}

function response(columns: CompareColumn[]): MarketplaceCompareResponse {
  return {
    period: SEPT,
    previousPeriod: { from: '2026-08-01', to: '2026-08-31' },
    columns,
    conclusions: [],
    notes: [],
    operatingExpensesKopecks: 0,
    taxIsDefault: false,
  };
}

const closed = column('wb', {
  state: 'closed',
  reason: 'закрыто',
  metrics: null,
  status: null,
  statusLabel: null,
});

describe('маппер «Сравнения площадок»', () => {
  it('ячейка открытой площадки ведёт в «Прибыль» этой площадки за тот же период', () => {
    const rows = compareRows(response([column('ozon')]));
    const revenue = rows.find((row) => row.key === 'revenue');
    expect(revenue?.cells[0]?.to).toEqual(financeLink('ozon', SEPT));
    expect(financeLink('ozon', SEPT)).toEqual({
      name: 'ozon-finance',
      params: { tab: 'pnl' },
      query: { from: '2026-09-01', to: '2026-09-30' },
    });
  });

  it('закрытая площадка — прочерк без ссылки, а не ноль', () => {
    const rows = compareRows(response([closed]));
    for (const row of rows)
      expect(row.cells[0]).toEqual({ marketplace: 'wb', text: '—', to: null });
  });

  it('расходы печатаются со знаком минус, доли — процентами', () => {
    const rows = compareRows(response([column('ym')]));
    const text = (key: string) =>
      rows.find((row) => row.key === key)?.cells[0]?.text.replace(/\s/g, ' ');
    expect(text('cogs')).toBe('-4 000 ₽');
    expect(text('commissionShare')).toBe('15,0 %');
  });

  it('доля выручки — только площадки с выручкой > 0', () => {
    const data = response([
      column('ym'),
      column('ozon', { metrics: metrics({ revenueKopecks: -5 }) }),
      closed,
    ]);
    expect(revenueSegments(data).map((s) => s.key)).toEqual(['ym']);
    expect(costSharePoints(data).map((p) => p.key)).toEqual(['ym', 'ozon']);
    expect(numberedColumns(data)).toBe(2);
  });

  it('схемы — одной таблицей по всем площадкам', () => {
    const data = response([
      column('ym', {
        schemes: [
          {
            marketplace: 'ym',
            scheme: 'FBS',
            revenueKopecks: 100_000,
            netKopecks: 20_000,
            margin: 0.2,
          },
        ],
      }),
      column('ozon', {
        schemes: [
          {
            marketplace: 'ozon',
            scheme: 'FBO',
            revenueKopecks: 50_000,
            netKopecks: 0,
            margin: null,
          },
        ],
      }),
    ]);
    expect(schemeRows(data).map((row) => [row.key, row.margin])).toEqual([
      ['ym:FBS', '20,0 %'],
      ['ozon:FBO', '—'],
    ]);
  });

  it('статус: проверено — ok, расхождения — danger, нет статуса — outline', () => {
    expect(statusTone('verified')).toBe('ok');
    expect(statusTone('discrepancy')).toBe('danger');
    expect(statusTone('preliminary')).toBe('warn');
    expect(statusTone(null)).toBe('outline');
  });
});
