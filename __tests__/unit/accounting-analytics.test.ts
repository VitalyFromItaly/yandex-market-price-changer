import type { IComputedOrder } from '../../src/modules/accounting/accounting-order-card.service';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type { IOrderCardOperation } from '../../src/modules/accounting/accounting-order-card.domain';
import type {
  IOrderResultAmount,
  TOrderResultKey,
  TOrderResultSource,
} from '../../src/modules/accounting/order-result';
import type { ICrmJobContext } from '../../src/modules/crm/jobs/crm-jobs.domain';

import { describe, expect, it, vi } from 'vitest';

import {
  ANALYTICS_NOT_CONNECTED_REASON,
  ANALYTICS_NOT_LOADED_REASON,
  ANALYTICS_NO_STORE_REASON,
  ANALYTICS_RETURN_MODELS_TOP,
  ANALYTICS_TOP,
  analyticsOf,
  averageOf,
  lossOrdersOf,
  modelOf,
  productsOf,
  profitByDayOf,
  returnModelsOf,
} from '../../src/modules/accounting/accounting-analytics.domain';
import { AccountingAnalyticsService } from '../../src/modules/accounting/accounting-analytics.service';
import { returnOfOrder } from '../../src/modules/accounting/accounting-returns.domain';
import {
  ACCOUNTING_ANALYTICS_KIND,
  ACCOUNTING_DASHBOARD_BAD_PERIOD_TEXT,
} from '../../src/modules/crm/accounting/crm-accounting.domain';
import { CrmAccountingKinds } from '../../src/modules/crm/accounting/crm-accounting.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { MARKETPLACE_LABEL } from '../../src/shared/marketplace';

/**
 * Аналитика «Финучёта» (TASK-230): ТОПы товаров по однотоварным заказам,
 * убыточные заказы, возвраты моделей через `returnResultOf`, средние только по
 * фактическим строкам, прибыль по дням, площадки рядом с причиной
 * `insufficientData`; kind — фичи панели и разбор периода.
 */

const PERIOD = { from: '2026-10-01', to: '2026-10-03' };

function line(partial: Partial<IAccountingOrderLineInput> = {}): IAccountingOrderLineInput {
  return {
    marketplace: 'ym',
    orderId: '100',
    itemId: '1',
    campaignId: '11',
    offerId: 'A1',
    offerName: 'Товар А',
    count: 1,
    priceKopecks: 100_000,
    buyerPriceKopecks: 100_000,
    buyerPriceBeforeDiscountKopecks: null,
    marketplaceSubsidyKopecks: 0,
    sellerDiscountKopecks: null,
    revenueKopecks: 100_000,
    payoutKopecks: null,
    commissionKopecks: null,
    status: 'DELIVERED',
    substatus: null,
    createdOn: '2026-10-01',
    soldOn: '2026-10-02',
    deliveryOn: null,
    returnedOn: null,
    source: 'ym-orders',
    ...partial,
  };
}

const amount = (
  key: TOrderResultKey,
  kopecks: number | null,
  source: TOrderResultSource = 'actual',
): IOrderResultAmount => ({ key, title: key, kopecks, source, operationIds: [] });

function order(
  lines: IAccountingOrderLineInput[],
  net: number | null,
  amounts: IOrderResultAmount[] = [],
  operations: IOrderCardOperation[] = [],
): IComputedOrder {
  const { marketplace, orderId } = lines[0];
  return {
    key: `${marketplace}|${orderId}`,
    marketplace,
    orderId,
    lines,
    operations,
    result: { amounts, net: { kopecks: net, source: 'actual', unknown: null } },
  } as unknown as IComputedOrder;
}

describe('modelOf', () => {
  it('одна модель в нескольких строках — модель; разные — null; отменённая не считается', () => {
    expect(modelOf(order([line(), line({ itemId: '2', count: 2 })], 0))).toBe('A1');
    expect(modelOf(order([line(), line({ itemId: '2', offerId: 'B2' })], 0))).toBeNull();
    expect(
      modelOf(order([line(), line({ itemId: '2', offerId: 'B2', status: 'CANCELLED' })], 0)),
    ).toBe('A1');
    expect(modelOf(order([line({ offerId: null })], 0))).toBeNull();
  });
});

describe('productsOf', () => {
  it('сумма прибыли однотоварных заказов, сортировки в обе стороны, многотоварные — счётчиком', () => {
    const orders = [
      order([line({ orderId: '1' })], 30_000),
      order([line({ orderId: '2', count: 2 })], 10_000),
      order([line({ orderId: '3', offerId: 'B2', offerName: 'Б' })], -5_000),
      order([line({ orderId: '4', offerId: 'C3' })], 1_000),
      order([line({ orderId: '5' }), line({ orderId: '5', itemId: '2', offerId: 'B2' })], 99_999),
      order([line({ orderId: '6', status: 'CANCELLED' })], -100),
    ];
    const result = productsOf(orders);
    expect(result.mostProfitable.map((p) => [p.offerId, p.profitKopecks])).toEqual([
      ['A1', 40_000],
      ['C3', 1_000],
      ['B2', -5_000],
    ]);
    expect(result.leastProfitable.map((p) => p.offerId)).toEqual(['B2', 'C3', 'A1']);
    expect(result.mostProfitable[0]).toMatchObject({
      ordersCount: 2,
      units: 3,
      label: MARKETPLACE_LABEL.ym,
    });
    expect(result.multiModelOrders).toBe(1);
  });

  it('модель с неизвестным заказом — null, в ТОПы не входит', () => {
    const result = productsOf([
      order([line({ orderId: '1' })], 30_000),
      order([line({ orderId: '2' })], null),
      order([line({ orderId: '3', offerId: 'B2' })], 1_000),
    ]);
    expect(result.mostProfitable.map((p) => p.offerId)).toEqual(['B2']);
    expect(result.unknownModels).toBe(1);
  });

  it('один артикул на разных площадках — разные модели, не складываются', () => {
    const result = productsOf([
      order([line({ orderId: '1' })], 100),
      order([line({ orderId: 'O1', marketplace: 'ozon' })], 200),
    ]);
    expect(result.mostProfitable.map((p) => [p.marketplace, p.profitKopecks])).toEqual([
      ['ozon', 200],
      ['ym', 100],
    ]);
  });

  it(`не больше ${ANALYTICS_TOP} в каждом ТОПе`, () => {
    const orders = Array.from({ length: ANALYTICS_TOP + 5 }, (_, i) =>
      order([line({ orderId: String(i), offerId: `M${i}` })], i),
    );
    const result = productsOf(orders);
    expect(result.mostProfitable).toHaveLength(ANALYTICS_TOP);
    expect(result.mostProfitable[0].profitKopecks).toBe(ANALYTICS_TOP + 4);
    expect(result.leastProfitable[0].profitKopecks).toBe(0);
  });
});

describe('lossOrdersOf', () => {
  it('только < 0, самые убыточные первыми, неизвестные пропущены, total — все', () => {
    const result = lossOrdersOf([
      order([line({ orderId: '1' })], -100),
      order([line({ orderId: '2' })], -5_000),
      order([line({ orderId: '3' })], 0),
      order([line({ orderId: '4' })], null),
      order([line({ orderId: '5', offerName: null })], 10),
    ]);
    expect(result.orders.map((o) => [o.orderId, o.resultKopecks])).toEqual([
      ['2', -5_000],
      ['1', -100],
    ]);
    expect(result.orders[0]).toMatchObject({ title: 'Товар А', createdOn: '2026-10-01' });
    expect(result.total).toBe(2);
  });
});

describe('returnModelsOf', () => {
  const returned = (partial: Partial<IAccountingOrderLineInput> = {}) =>
    line({ status: 'RETURNED', returnedOn: '2026-10-20', ...partial });
  const reverse = (orderId: string, amountKopecks: number) =>
    ({
      id: `rl-${orderId}`,
      article: 'reverse_logistics',
      amountKopecks,
      orderId,
      sku: null,
      serviceName: null,
      transactionType: 'Удержание',
      transactionSource: null,
      accruedAt: new Date('2026-10-20T09:00:00Z'),
      paidAt: null,
      actDate: null,
      model: 'FBS',
      count: null,
      marketplace: 'ym',
      origin: 'journal',
      documentId: null,
      subArticle: null,
    }) as IOrderCardOperation;

  it('результат возврата — returnResultOf заказа; многотоварные возвраты — счётчиком', () => {
    const a1 = order([returned({ orderId: 'r1' })], null, [], [reverse('r1', -6_000)]);
    const a2 = order([returned({ orderId: 'r2', count: 2 })], null, [], [reverse('r2', -1_000)]);
    const b = order(
      [returned({ orderId: 'r3', offerId: 'B2' }), line({ orderId: 'r3', itemId: '2' })],
      null,
      [],
      [reverse('r3', -500)],
    );
    const mixed = order(
      [returned({ orderId: 'r4' }), returned({ orderId: 'r4', itemId: '2', offerId: 'B2' })],
      null,
    );
    const result = returnModelsOf([a1, a2, b, mixed, order([line({ orderId: 's' })], 100)]);
    const expectedA =
      (returnOfOrder(a1).resultKopecks ?? 0) + (returnOfOrder(a2).resultKopecks ?? 0);
    expect(result.models.map((m) => [m.offerId, m.resultKopecks, m.returnedUnits])).toEqual([
      ['A1', expectedA, 3],
      ['B2', returnOfOrder(b).resultKopecks, 1],
    ]);
    expect(result.multiModelReturns).toBe(1);
  });

  it(`не больше ${ANALYTICS_RETURN_MODELS_TOP} моделей`, () => {
    const orders = Array.from({ length: ANALYTICS_RETURN_MODELS_TOP + 3 }, (_, i) =>
      order([returned({ orderId: `r${i}`, offerId: `M${i}` })], null),
    );
    expect(returnModelsOf(orders).models).toHaveLength(ANALYTICS_RETURN_MODELS_TOP);
  });
});

describe('averageOf', () => {
  it('только фактические строки; доля — от выручки тех же заказов', () => {
    const orders = [
      order([line({ orderId: '1' })], 0, [
        amount('revenue', 100_000),
        amount('commission', -10_000),
      ]),
      order([line({ orderId: '2' })], 0, [amount('revenue', 50_000), amount('commission', -5_000)]),
      order([line({ orderId: '3' })], 0, [
        amount('revenue', 70_000, 'expected'),
        amount('commission', -7_000, 'expected'),
      ]),
    ];
    expect(averageOf(orders, 'commission')).toEqual({
      ordersCount: 2,
      avgKopecks: -7_500,
      shareOfRevenue: -0.1,
    });
    expect(averageOf(orders, 'delivery')).toEqual({
      ordersCount: 0,
      avgKopecks: null,
      shareOfRevenue: null,
    });
  });
});

describe('profitByDayOf', () => {
  it('все дни периода по площадке, пустой день — 0, неизвестный заказ — null дня', () => {
    const days = profitByDayOf(
      [
        order([line({ orderId: '1' })], 100),
        order([line({ orderId: '2' })], 50),
        order([line({ orderId: '3', createdOn: '2026-10-02' })], null),
        order([line({ orderId: 'O1', marketplace: 'ozon', createdOn: '2026-10-03' })], 7),
      ],
      ['ym', 'ozon'],
      PERIOD,
    );
    expect(days.filter((d) => d.marketplace === 'ym')).toEqual([
      { day: '2026-10-01', marketplace: 'ym', ordersCount: 2, profitKopecks: 150, unknownCount: 0 },
      {
        day: '2026-10-02',
        marketplace: 'ym',
        ordersCount: 1,
        profitKopecks: null,
        unknownCount: 1,
      },
      { day: '2026-10-03', marketplace: 'ym', ordersCount: 0, profitKopecks: 0, unknownCount: 0 },
    ]);
    expect(days.filter((d) => d.marketplace === 'ozon').map((d) => d.profitKopecks)).toEqual([
      0, 0, 7,
    ]);
  });
});

describe('analyticsOf — площадки рядом', () => {
  const ym = order([line({ orderId: '1' })], 20_000, [amount('revenue', 100_000)]);
  const ozon = order([line({ orderId: 'O1', marketplace: 'ozon' })], -1_000, [
    amount('revenue', 50_000),
  ]);

  it('у каждой площадки свои числа; недоступная — insufficientData с причиной и вне блоков', () => {
    const result = analyticsOf(
      [ym, ozon],
      { ym: null, ozon: ANALYTICS_NOT_LOADED_REASON, wb: ANALYTICS_NOT_CONNECTED_REASON },
      PERIOD,
    );
    expect(result.marketplaces[0]).toMatchObject({
      marketplace: 'ym',
      insufficientData: false,
      ordersCount: 1,
      revenueKopecks: 100_000,
      profitKopecks: 20_000,
      margin: 0.2,
    });
    expect(result.marketplaces[1]).toEqual({
      marketplace: 'ozon',
      label: MARKETPLACE_LABEL.ozon,
      insufficientData: true,
      reason: ANALYTICS_NOT_LOADED_REASON,
    });
    expect(result.marketplaces[2]).toMatchObject({ marketplace: 'wb', insufficientData: true });
    expect(result.lossOrders.total).toBe(0);
    expect(new Set(result.days.map((d) => d.marketplace))).toEqual(new Set(['ym']));
  });
});

describe('AccountingAnalyticsService', () => {
  const sync = (loaded: string[]) => ({
    marketplaces: loaded.map((marketplace) => ({
      marketplace,
      lastSuccessAt: '2026-10-05T00:00:00Z',
    })),
  });

  it('причины: не подключена, ЯМ без магазина, реестр не загружен', async () => {
    const ordersCreatedIn = vi.fn(async () => []);
    const service = new AccountingAnalyticsService(
      {
        marketplacesOf: async () => ['ym', 'ozon'],
        syncStatus: async () => sync(['ym']),
      } as never,
      { ordersCreatedIn } as never,
    );
    const noStore = await service.period('u1', {}, null, PERIOD);
    expect(noStore.marketplaces.map((m) => (m.insufficientData ? m.reason : null))).toEqual([
      ANALYTICS_NO_STORE_REASON,
      ANALYTICS_NOT_LOADED_REASON,
      ANALYTICS_NOT_CONNECTED_REASON,
    ]);
    expect(ordersCreatedIn).not.toHaveBeenCalled();

    const withStore = await service.period('u1', {}, { campaign_id: 11 } as never, PERIOD);
    expect(withStore.marketplaces[0].insufficientData).toBe(false);
    expect(withStore.period).toEqual(PERIOD);
    expect(ordersCreatedIn).toHaveBeenCalledWith(
      'u1',
      {},
      { campaign_id: 11 },
      PERIOD,
      null,
      expect.any(Date),
    );
  });
});

describe('CrmAccountingKinds — аналитика', () => {
  const context = (params: Record<string, unknown>): ICrmJobContext => ({
    jobId: 'j1',
    telegramUserId: 'u1',
    store: null,
    params,
    features: {},
  });
  const kindsWith = (analytics: unknown, register = vi.fn()) =>
    new CrmAccountingKinds(
      { register } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      analytics as never,
    );

  it('kind под фичами панели', () => {
    const register = vi.fn();
    kindsWith({}, register).onModuleInit();
    const call = register.mock.calls.find(([kind]) => kind === ACCOUNTING_ANALYTICS_KIND);
    expect(call?.[1].features).toEqual(['fin_accounting', 'fin_accounting_dashboard']);
  });

  it('период «с — по» уходит в сервис с эхо; мусор и «всё время» — CrmJobError', async () => {
    const period = vi.fn(async (_u, _f, _s, p) => ({ period: p }));
    const kinds = kindsWith({ period });
    const out = await kinds.analyticsPeriod(
      context({ range: { from: '2026-10-01', to: '2026-10-03' } }),
    );
    expect(period).toHaveBeenCalledWith('u1', {}, null, PERIOD, expect.any(Date));
    expect(out.data).toMatchObject({ period: PERIOD, periodEcho: { range: PERIOD } });

    await expect(
      kinds.analyticsPeriod(context({ range: { from: 'x', to: '2026-10-03' } })),
    ).rejects.toThrow(new CrmJobError(ACCOUNTING_DASHBOARD_BAD_PERIOD_TEXT));
    await expect(kinds.analyticsPeriod(context({ period: 'all' }))).rejects.toThrow(CrmJobError);
  });
});
