import { describe, it, expect } from 'vitest';

import type {
  IOfferLogistics,
  ITariffCalculation,
} from '../../src/modules/yandex/yandex-api.client';
import {
  buildTariffRows,
  DEFAULT_DIMENSION_CM,
  DEFAULT_WEIGHT_KG,
  estimateOf,
  tariffPriceOf,
  unitCostsOf,
  type ITariffEstimateOrder,
} from '../../src/modules/yandex/reports/tariff-estimate';

const logisticsMap = (entries: IOfferLogistics[]): Map<string, IOfferLogistics> =>
  new Map(entries.map((e) => [e.offerId, e]));

const LOGISTICS = logisticsMap([
  {
    offerId: 'A-1',
    marketCategoryId: 111,
    weightDimensions: { length: 10, width: 8, height: 5, weight: 0.4 },
  },
  { offerId: 'B-2', marketCategoryId: 222 }, // габаритов нет — фолбэк
  { offerId: 'C-3' }, // категории нет — посчитать нельзя
]);

describe('tariffPriceOf: цена для калькулятора', () => {
  it('цена позиции плюс субсидии Маркета на единицу', () => {
    // Реальная комиссия берётся с цены С субсидией (пример продавца:
    // 2689 × 23%). На боевом за июль-2026 вариант с субсидией дал 23,9%
    // против 20,0% без неё.
    const price = tariffPriceOf({
      price: 2000,
      subsidies: [
        { type: 'YANDEX_CASHBACK', amount: 300 },
        { type: 'SUBSIDY', amount: 389 },
      ],
    });
    expect(price).toBe(2689);
  });

  it('субсидия за доставку не входит — принцип subsidiesTotal', () => {
    expect(tariffPriceOf({ price: 1000, subsidies: [{ type: 'DELIVERY', amount: 99 }] })).toBe(
      1000,
    );
  });

  it('мусор в цене и субсидиях не даёт NaN', () => {
    expect(tariffPriceOf({ price: undefined, subsidies: [{ amount: undefined }] })).toBe(0);
  });
});

describe('buildTariffRows: строки запроса', () => {
  it('пары (артикул, цена) уникальны — одинаковые позиции не плодят строк', () => {
    const orders: ITariffEstimateOrder[] = [
      { items: [{ offerId: 'A-1', price: 100 }] },
      { items: [{ offerId: 'A-1', price: 100 }] },
      { items: [{ offerId: 'A-1', price: 200 }] },
    ];

    const { rows } = buildTariffRows(orders, LOGISTICS);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.params.price)).toEqual([100, 200]);
  });

  it('габариты из каталога, а при их отсутствии — фолбэк 11×11×11 / 0,3 кг', () => {
    const { rows } = buildTariffRows(
      [
        {
          items: [
            { offerId: 'A-1', price: 100 },
            { offerId: 'B-2', price: 100 },
          ],
        },
      ],
      LOGISTICS,
    );

    const real = rows.find((r) => r.params.categoryId === 111);
    const fallback = rows.find((r) => r.params.categoryId === 222);

    expect(real?.params).toMatchObject({ length: 10, width: 8, height: 5, weight: 0.4 });
    expect(fallback?.params).toMatchObject({
      length: DEFAULT_DIMENSION_CM,
      width: DEFAULT_DIMENSION_CM,
      height: DEFAULT_DIMENSION_CM,
      weight: DEFAULT_WEIGHT_KG,
    });
  });

  it('нулевые габариты — тоже фолбэк: ноль калькулятор отвергает (400)', () => {
    const withZeros = logisticsMap([
      {
        offerId: 'Z-0',
        marketCategoryId: 333,
        weightDimensions: { length: 10, width: 0, height: 5, weight: 0.4 },
      },
    ]);

    const { rows } = buildTariffRows([{ items: [{ offerId: 'Z-0', price: 50 }] }], withZeros);

    expect(rows[0].params).toMatchObject({
      length: DEFAULT_DIMENSION_CM,
      width: DEFAULT_DIMENSION_CM,
      height: DEFAULT_DIMENSION_CM,
      weight: DEFAULT_WEIGHT_KG,
    });
  });

  it('без категории или без положительной цены — в uncoveredSkus', () => {
    const { rows, uncoveredSkus } = buildTariffRows(
      [
        {
          items: [
            { offerId: 'C-3', price: 100 }, // нет категории
            { offerId: 'D-4', price: 100 }, // нет в каталоге вовсе
            { offerId: 'A-1', price: 0 }, // цена не положительная
          ],
        },
      ],
      LOGISTICS,
    );

    expect(rows).toHaveLength(0);
    expect(uncoveredSkus.sort()).toEqual(['A-1', 'C-3', 'D-4']);
  });
});

describe('unitCostsOf: разбор ответа калькулятора', () => {
  const rows = buildTariffRows([{ items: [{ offerId: 'A-1', price: 100 }] }], LOGISTICS).rows;

  it('суммирует ВСЕ услуги, дубли типа — тоже', () => {
    // На боевом дублей не встречено, но правило — «сумма всего списка», а не
    // «по одной услуге каждого типа»: иначе дубль молча терял бы деньги.
    const calcs: ITariffCalculation[] = [
      {
        offer: rows[0].params,
        tariffs: [
          { type: 'FEE', amount: 20 },
          { type: 'SORTING', amount: 10 },
          { type: 'SORTING', amount: 5 },
        ],
      },
    ];

    const costs = unitCostsOf(rows, calcs);
    const cost = costs.get(rows[0].key);

    expect(cost?.servicesTotal).toBe(35);
    expect(cost?.byService).toEqual({ FEE: 20, SORTING: 15 });
  });

  it('отсутствующий amount — ноль, а не NaN', () => {
    const costs = unitCostsOf(rows, [
      { offer: rows[0].params, tariffs: [{ type: 'FEE' }, { type: 'SORTING', amount: 7 }] },
    ]);

    expect(costs.get(rows[0].key)?.servicesTotal).toBe(7);
  });

  it('ответ короче запроса не роняет разбор — лишние строки без стоимости', () => {
    expect(unitCostsOf(rows, []).size).toBe(0);
  });
});

describe('estimateOf: свод по заказам', () => {
  const orders: ITariffEstimateOrder[] = [
    {
      itemsTotal: 300,
      subsidies: [{ type: 'SUBSIDY', amount: 50 }],
      items: [{ offerId: 'A-1', price: 100, count: 3 }],
    },
    {
      itemsTotal: 500,
      items: [{ offerId: 'C-3', price: 500 }], // непокрытый артикул
    },
  ];

  const { rows } = buildTariffRows(orders, LOGISTICS);
  const costs = unitCostsOf(rows, [
    { offer: rows[0].params, tariffs: [{ type: 'FEE', amount: 25 }] },
  ]);

  it('стоимость единицы умножается на count, выручка покрытых — с субсидиями', () => {
    const estimate = estimateOf(orders, costs, 'redeemed');

    expect(estimate.servicesTotal).toBe(75); // 25 × 3
    expect(estimate.byService).toEqual({ FEE: 75 });
    expect(estimate.coveredOrders).toBe(1);
    expect(estimate.totalOrders).toBe(2);
    expect(estimate.coveredRevenue).toBe(350); // itemsTotal + субсидия заказа
    expect(estimate.scope).toBe('redeemed');
  });

  it('заказ с непосчитанной позицией исключается ЦЕЛИКОМ — принцип profitOf', () => {
    // Частично посчитанный заказ дал бы сумму, которую не с чем сверить, —
    // тот же довод, по которому profitOf исключает заказ без закупочной цены.
    const mixed: ITariffEstimateOrder[] = [
      {
        itemsTotal: 600,
        items: [
          { offerId: 'A-1', price: 100 },
          { offerId: 'C-3', price: 500 },
        ],
      },
    ];

    const estimate = estimateOf(mixed, costs, 'placed');

    expect(estimate.coveredOrders).toBe(0);
    expect(estimate.servicesTotal).toBe(0);
    expect(estimate.coveredRevenue).toBe(0);
  });

  it('заказ без позиций не считается покрытым', () => {
    const estimate = estimateOf([{ itemsTotal: 100, items: [] }], costs, 'placed');
    expect(estimate.coveredOrders).toBe(0);
    expect(estimate.totalOrders).toBe(1);
  });
});
