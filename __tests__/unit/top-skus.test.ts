import { describe, expect, it } from 'vitest';

import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { parsePeriodParams, periodEcho } from '../../src/modules/crm/jobs/crm-period.domain';
import { toCrmTopSkusView } from '../../src/modules/crm/top-skus/crm-top-skus.domain';
import { requiredFeatures, FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import {
  NO_REGION_LABEL,
  NO_WAREHOUSE_LABEL,
  OWN_WAREHOUSE_LABEL,
  clusterLabel,
  placeResolver,
  regionIdsOf,
  regionLabel,
  regionRowOf,
} from '../../src/modules/yandex/regions/ym-regions.domain';
import { profitOf } from '../../src/modules/yandex/reports/profit';
import {
  MAX_RANGE_DAYS,
  PERIOD,
  assertPeriodOrdered,
  parseRangeInput,
  periodBounds,
  periodTitle,
  periodWindows,
} from '../../src/modules/yandex/reports/report-period';
import { statsOrderToReportOrder } from '../../src/modules/yandex/reports/stats-orders';
import { topSkusWorkbook } from '../../src/modules/yandex/top-skus/top-skus-workbook';
import {
  TOP_SKUS_MESSAGE_ROWS,
  formatTopSkus,
  parseTopCallback,
  topCallback,
  topSkusOf,
} from '../../src/modules/yandex/top-skus/top-skus.domain';
import { YandexDateRangeError } from '../../src/modules/yandex/yandex-date-window';

const NOW = new Date('2026-11-17T09:00:00Z');
const d = (day: number, month: number, year = 2026) => ({ year, month, day });

describe('период «свой диапазон» (PERIOD.RANGE)', () => {
  it('границы — ровно присланные даты, окна по 30 дней', () => {
    const period = { key: PERIOD.RANGE, from: d(1, 9), to: d(15, 11) };
    expect(periodBounds(period, NOW)).toEqual({ from: d(1, 9), to: d(15, 11) });
    const windows = periodWindows(period, NOW);
    expect(windows[0]).toEqual({ from: d(1, 9), to: d(30, 9) });
    expect(windows.at(-1).to).toEqual(d(15, 11));
    expect(periodTitle(period, NOW)).toBe('за 01-09-2026 — 15-11-2026');
  });

  it('длиннее года и задом наперёд — понятный отказ', () => {
    expect(() =>
      assertPeriodOrdered({ key: PERIOD.RANGE, from: d(1, 1, 2025), to: d(15, 11) }, NOW),
    ).toThrow(YandexDateRangeError);
    expect(() =>
      assertPeriodOrdered({ key: PERIOD.RANGE, from: d(10, 11), to: d(1, 11) }, NOW),
    ).toThrow(YandexDateRangeError);
    expect(MAX_RANGE_DAYS).toBe(366);
  });

  it('ввод двумя датами: пробел, тире, дефис с пробелами', () => {
    const expected = { from: d(1, 10), to: d(31, 10) };
    expect(parseRangeInput('01-10-2026 31-10-2026')).toEqual(expected);
    expect(parseRangeInput('01.10.2026 — 31.10.2026')).toEqual(expected);
    expect(parseRangeInput('01.10.2026 - 31.10.2026')).toEqual(expected);
    expect(parseRangeInput('01.10.2026')).toBeNull();
    expect(parseRangeInput('31-02-2026 01-03-2026')).toBeNull();
  });

  it('CRM принимает range только там, где kind его разрешил', () => {
    const params = { period: { key: 'range', from: '01-10-2026', to: '31-10-2026' } };
    expect(() => parsePeriodParams(params)).toThrow(CrmJobError);
    const period = parsePeriodParams(params, [PERIOD.RANGE]);
    expect(period).toEqual({ key: PERIOD.RANGE, from: d(1, 10), to: d(31, 10) });
    expect(periodEcho(period)).toEqual({
      key: 'range',
      day: null,
      from: '01-10-2026',
      to: '31-10-2026',
    });
    expect(() =>
      parsePeriodParams({ period: { key: 'range', from: '01-10-2026' } }, [PERIOD.RANGE]),
    ).toThrow(CrmJobError);
    // Эхо прежних периодов не меняется.
    expect(periodEcho({ key: PERIOD.MONTH })).toEqual({ key: 'month', day: null });
  });
});

describe('архив stats/orders: регион и склад не выбрасываются', () => {
  it('deliveryRegion и items[].warehouse доезжают до формы отчётов', () => {
    const order = statsOrderToReportOrder({
      id: 1,
      status: 'DELIVERED',
      deliveryRegion: { id: 213, name: 'Москва' },
      items: [
        {
          shopSku: 'A',
          count: 1,
          prices: [{ type: 'BUYER', costPerItem: 100 }],
          warehouse: { id: 7, name: 'Яндекс Маркет (Софьино)' },
        },
      ],
    });
    expect(order.region).toEqual({ id: 213, name: 'Москва' });
    expect(order.items[0].warehouse).toEqual({ id: 7, name: 'Яндекс Маркет (Софьино)' });
    expect(statsOrderToReportOrder({ id: 2, items: [] }).region).toBeUndefined();
  });
});

describe('регионы и кластеры (ym-regions.domain)', () => {
  const city = {
    id: 43,
    name: 'Казань',
    type: 'CITY',
    parent: {
      id: 11119,
      name: 'Республика Татарстан',
      type: 'REPUBLIC',
      parent: { id: 40, name: 'Приволжский федеральный округ', type: 'COUNTRY_DISTRICT' },
    },
  };

  it('город поднимается до субъекта и федерального округа', () => {
    expect(regionRowOf(city)).toEqual({
      regionId: 43,
      name: 'Казань',
      subject: 'Республика Татарстан',
      district: 'Приволжский федеральный округ',
    });
    expect(regionRowOf({ name: 'без id' })).toBeNull();
  });

  it('подпись: субъект из кэша → имя региона → «не указан»', () => {
    const cache = new Map([[43, regionRowOf(city)]]);
    expect(regionLabel({ id: 43, name: 'Казань' }, cache)).toBe('Республика Татарстан');
    expect(regionLabel({ id: 99, name: 'Пермь' }, cache)).toBe('Пермь');
    expect(regionLabel(undefined, cache)).toBe(NO_REGION_LABEL);
  });

  it('кластер: FBS — свой склад, FBY — по имени склада, незнакомый — своим именем', () => {
    expect(clusterLabel({ name: 'Софьино' }, false)).toBe(OWN_WAREHOUSE_LABEL);
    expect(clusterLabel(undefined, true)).toBe(NO_WAREHOUSE_LABEL);
    expect(clusterLabel({ name: 'Склад на Луне' }, true)).toBe('Склад на Луне');
  });

  it('id регионов — без повторов', () => {
    expect(
      regionIdsOf([{ region: { id: 1 } }, { region: { id: 1 } }, {}, { region: { id: 2 } }]),
    ).toEqual([1, 2]);
  });
});

describe('profitOf с местами: Σ по регионам = Σ по кластерам = итог', () => {
  const orders = [
    {
      id: 1,
      itemsTotal: 1000,
      region: { id: 43, name: 'Казань' },
      items: [
        { offerId: 'A', count: 1, price: 600, warehouse: { name: 'X' } },
        { offerId: 'B', count: 2, price: 200, warehouse: { name: 'Y' } },
      ],
    },
    {
      id: 2,
      itemsTotal: 500,
      items: [{ offerId: 'A', count: 1, price: 500 }],
    },
  ];
  const costs = new Map([
    ['A', 100],
    ['B', 50],
  ]);

  it('разрезы появляются только с placeOf и сходятся с итогом', () => {
    const plain = profitOf(orders, costs);
    expect(plain.byRegion).toBeUndefined();
    expect(plain.bySku[0].byRegion).toBeUndefined();

    const totals = profitOf(orders, costs, undefined, {
      placeOf: placeResolver(new Map(), true),
    });
    const sum = (rows: { revenue: number; net: number; count: number }[]) =>
      rows.reduce(
        (acc, row) => ({
          revenue: acc.revenue + row.revenue,
          net: acc.net + row.net,
          count: acc.count + row.count,
        }),
        { revenue: 0, net: 0, count: 0 },
      );
    const regions = sum(totals.byRegion);
    const clusters = sum(totals.byCluster);
    expect(regions.revenue).toBeCloseTo(totals.revenue);
    expect(clusters.revenue).toBeCloseTo(totals.revenue);
    expect(regions.net).toBeCloseTo(totals.net);
    expect(clusters.net).toBeCloseTo(totals.net);
    expect(regions.count).toBe(4);
    expect(totals.byRegion.map((row) => row.name).sort()).toEqual(['Казань', NO_REGION_LABEL]);

    // Строка товара раскладывается так же: товар A — в обоих регионах.
    const a = totals.bySku.find((row) => row.sku === 'A');
    expect(sum(a.byRegion).revenue).toBeCloseTo(a.revenue);
    expect(a.byRegion.map((row) => row.name).sort()).toEqual(['Казань', NO_REGION_LABEL]);
  });
});

describe('«Топ товаров»: вид, текст, кнопки, файл', () => {
  const sku = (n: number, revenue: number) => ({
    sku: `S${n}`,
    name: `Товар ${n}`,
    count: 1,
    revenue,
    net: revenue / 2,
    margin: 0.5,
    returns: 0,
  });
  const block = (skus: ReturnType<typeof sku>[], orders: number) => ({
    orders,
    revenue: skus.reduce((s, r) => s + r.revenue, 0),
    net: skus.reduce((s, r) => s + r.net, 0),
    bySku: skus,
    unconfirmed: { confirmed: true, orders: 0, revenueKopecks: 0, skus: [] },
  });
  const many = Array.from({ length: 20 }, (_, i) => sku(i + 1, 1000 - i));
  const report = {
    period: { key: PERIOD.MONTH },
    totals: block([sku(99, 1)], 1),
    placed: block(many, 20),
  } as never;

  it('берёт основной блок «Прибыли» и ВСЕ товары', () => {
    const view = topSkusOf(report);
    expect(view.scope).toBe('placed');
    expect(view.skus).toHaveLength(20);
    expect(view.orders).toBe(20);
  });

  it('сообщение: первые 15 и «остальные — в файле»', () => {
    const text = formatTopSkus(topSkusOf(report), NOW);
    expect(text).toContain(`${TOP_SKUS_MESSAGE_ROWS}. Товар 15`);
    expect(text).not.toContain('16. Товар 16');
    expect(text).toContain('Остальные 5 — в файле.');
  });

  it('файл открывается и несёт все строки', () => {
    expect(topSkusWorkbook(topSkusOf(report)).length).toBeGreaterThan(0);
  });

  it('кнопки периода и их гейт', () => {
    expect(parseTopCallback(topCallback(PERIOD.RANGE))).toBe(PERIOD.RANGE);
    expect(parseTopCallback('top:all')).toBeNull();
    expect(requiredFeatures({ callbackData: 'top:month' })).toEqual([FEATURE.REPORT_PROFIT]);
  });

  it('CRM-вид: без среза строк, разрезы null при закрытой фиче', () => {
    const view = toCrmTopSkusView(topSkusOf(report), NOW);
    expect(view.skus).toHaveLength(20);
    expect(view.byRegion).toBeNull();
    expect(view.period).toEqual({ key: 'month', day: null });
  });
});
