import { describe, expect, it, vi } from 'vitest';

import { expandBreakdown } from '../../src/modules/finance/operation-breakdown';
import {
  ozonAccrualArticle,
  ozonGoodsMovement,
  ozonOperationTypeArticle,
  ozonServiceArticle,
} from '../../src/modules/finance/ozon-articles';
import {
  OZON_UNKNOWN_ARTICLE_CONTEXT,
  ozonFinanceOriginal,
  ozonOperationKey,
  ozonOperationParts,
  ozonOperationToRow,
  ozonOperationsInPeriod,
  ozonUnknownGroups,
  parseOzonDateTime,
  reportOzonUnknownArticles,
} from '../../src/modules/finance/ozon-journal';
import { pnlLineOf } from '../../src/modules/finance/pnl';

/**
 * Разбор операций Ozon /v3/finance/transaction/list (TASK-131). Форма операции —
 * по Go-клиенту `diphantxm/ozon-api-client` (finance.go); на живом ответе не
 * сверена (known-gaps).
 */

const CTX = {
  telegramUserId: '111',
  businessId: 'client-1',
  documentId: 'doc-1',
  documentVersion: 1,
  periodKey: 'ozon-transaction-list:2026-09-01:2026-09-30',
};

/** Продажа: выручка 2000, комиссия −300, доставка −150, две услуги. */
const sale = (over: Record<string, unknown> = {}) => ({
  operation_id: 21600000001,
  operation_type: 'OperationAgentDeliveredToCustomer',
  operation_type_name: 'Доставка покупателю',
  operation_date: '2026-09-16 00:00:00',
  type: 'orders',
  accruals_for_sale: 2000,
  sale_commission: -300,
  delivery_charge: -150,
  return_delivery_charge: 0,
  amount: 1450,
  posting: {
    delivery_schema: 'fbo',
    order_date: '2026-09-10 12:00:00',
    posting_number: '0123-0001-1',
    warehouse_id: 1,
  },
  items: [{ name: 'Часы', sku: 900001 }],
  services: [
    { name: 'MarketplaceServiceItemFulfillment', price: -60 },
    { name: 'MarketplaceServiceItemDirectFlowLogistic', price: -40 },
  ],
  ...over,
});

describe('классификатор статей Ozon', () => {
  it('выручка — продажа или возврат по типу операции; иной тип — незнакомое', () => {
    expect(ozonAccrualArticle('OperationAgentDeliveredToCustomer')).toBe('sales');
    expect(ozonAccrualArticle('ClientReturnAgentOperation')).toBe('returns');
    expect(ozonAccrualArticle('OperationAgentStornoDeliveredToCustomer')).toBe('returns');
    expect(ozonAccrualArticle('SomethingNew')).toBe('unknown');
  });

  it('услуги и типы без составляющих — точное сравнение, незнакомое — unknown', () => {
    expect(ozonServiceArticle('MarketplaceServiceItemFulfillment')).toBe('processing');
    expect(ozonServiceArticle('MarketplaceServiceItemReturnFlowLogistic')).toBe(
      'reverse_logistics',
    );
    expect(ozonServiceArticle('MarketplaceRedistributionOfAcquiringOperation')).toBe('acquiring');
    expect(ozonServiceArticle('  MarketplaceServiceItemDirectFlowTrans ')).toBe(
      'delivery_to_buyer',
    );
    expect(ozonServiceArticle('MarketplaceServiceItemFulfillmentNew')).toBe('unknown');
    expect(ozonOperationTypeArticle('OperationMarketplaceServiceStorage')).toBe('storage');
    expect(ozonOperationTypeArticle('MarketplaceSellerCompensationOperation')).toBe(
      'compensations',
    );
    expect(ozonOperationTypeArticle('Unknown')).toBe('unknown');
  });

  it('товар двигает только часть выручки продажи или возврата', () => {
    expect(ozonGoodsMovement('OperationAgentDeliveredToCustomer', 'sales')).toBe('sold');
    expect(ozonGoodsMovement('OperationAgentDeliveredToCustomer', 'commission')).toBeNull();
    expect(ozonGoodsMovement('ClientReturnAgentOperation', 'returns')).toBe('returned');
    expect(ozonGoodsMovement('MarketplaceSellerCompensationOperation', 'compensations')).toBeNull();
  });
});

describe('дата операции', () => {
  it('без пояса — время по Москве; с поясом — как пришло; мусор — null', () => {
    expect(parseOzonDateTime('2026-09-16 00:00:00')?.toISOString()).toBe(
      '2026-09-15T21:00:00.000Z',
    );
    expect(parseOzonDateTime('2026-09-16T10:00:00Z')?.toISOString()).toBe(
      '2026-09-16T10:00:00.000Z',
    );
    expect(parseOzonDateTime('2026-09-16T10:00:00+0500')?.toISOString()).toBe(
      '2026-09-16T05:00:00.000Z',
    );
    expect(parseOzonDateTime('2026-09-16')?.toISOString()).toBe('2026-09-15T21:00:00.000Z');
    expect(parseOzonDateTime('2026-02-31 00:00:00')).toBeNull();
    expect(parseOzonDateTime('16.09.2026')).toBeNull();
    expect(parseOzonDateTime(null)).toBeNull();
  });
});

describe('операция → строка журнала', () => {
  it('продажа: сумма amount, части по статьям, заказ, схема, артикул через ключ закупа', () => {
    const op = ozonOperationToRow(sale(), CTX, (sku) => (sku === '900001' ? 'A1' : undefined));

    expect(op).toMatchObject({
      marketplace: 'ozon',
      operationKey: ozonOperationKey('21600000001', 145000),
      article: 'sales',
      direction: 'income',
      amountKopecks: 145000,
      orderId: '0123-0001-1',
      sku: 'A1',
      model: 'FBO',
      transactionType: 'OperationAgentDeliveredToCustomer',
      transactionSource: 'orders',
      serviceName: 'Доставка покупателю',
      accruedAt: new Date('2026-09-15T21:00:00Z'),
      periodKey: CTX.periodKey,
    });
    expect(op.breakdown).toEqual([
      { article: 'sales', kopecks: 200000, sheet: 'accruals_for_sale' },
      { article: 'commission', kopecks: -30000, sheet: 'sale_commission' },
      { article: 'delivery_to_buyer', kopecks: -15000, sheet: 'delivery_charge' },
      { article: 'processing', kopecks: -6000, sheet: 'MarketplaceServiceItemFulfillment' },
      {
        article: 'delivery_to_buyer',
        kopecks: -4000,
        sheet: 'MarketplaceServiceItemDirectFlowLogistic',
      },
    ]);
    // Σ частей = сумме операции — иначе expandBreakdown оставил бы её целой.
    expect(op.breakdown?.reduce((sum, p) => sum + p.kopecks, 0)).toBe(op.amountKopecks);
    expect(op.raw).toEqual(sale());
  });

  it('SKU не нашёлся в каталоге — остаётся SKU Ozon; два артикула — пусто', () => {
    expect(ozonOperationToRow(sale(), CTX).sku).toBe('900001');
    const two = sale({
      items: [
        { name: 'A', sku: 1 },
        { name: 'B', sku: 2 },
      ],
    });
    expect(ozonOperationToRow(two, CTX).sku).toBeUndefined();
    const same = sale({
      items: [
        { name: 'A', sku: 1 },
        { name: 'A', sku: 1 },
      ],
    });
    expect(ozonOperationToRow(same, CTX).sku).toBe('1');
  });

  it('операция без составляющих — статья по типу, без расшифровки', () => {
    const storage = ozonOperationToRow(
      {
        operation_id: 5,
        operation_type: 'OperationMarketplaceServiceStorage',
        operation_date: '2026-09-20 00:00:00',
        type: 'services',
        accruals_for_sale: 0,
        sale_commission: 0,
        delivery_charge: 0,
        return_delivery_charge: 0,
        amount: -120.5,
        posting: { posting_number: '' },
        items: [],
        services: [],
      },
      CTX,
    );
    expect(storage).toMatchObject({
      article: 'storage',
      amountKopecks: -12050,
      direction: 'expense',
    });
    expect(storage.breakdown).toBeUndefined();
    expect(storage.orderId).toBeUndefined();
  });

  it('незнакомая услуга и несошедшийся остаток — unknown у части и у строки', () => {
    const op = ozonOperationToRow(
      sale({ services: [{ name: 'BrandNewService', price: -10 }], amount: 1540 }),
      CTX,
    );
    expect(op.article).toBe('unknown');
    expect(op.breakdown).toContainEqual({
      article: 'unknown',
      kopecks: -1000,
      sheet: 'BrandNewService',
    });
    const remainder = ozonOperationToRow(sale({ services: [], amount: 1555 }), CTX);
    expect(remainder.breakdown).toContainEqual({ article: 'unknown', kopecks: 500, sheet: null });
    expect(ozonUnknownGroups([op, remainder]).map((g) => g.signature)).toEqual([
      'услуга BrandNewService',
      'остаток без составляющей у типа OperationAgentDeliveredToCustomer',
    ]);
  });

  it('одна статья — расшифровки нет: строка и есть эта статья', () => {
    const op = ozonOperationToRow(
      sale({ sale_commission: 0, delivery_charge: 0, services: [], amount: 2000 }),
      CTX,
    );
    expect(op.article).toBe('sales');
    expect(op.breakdown).toBeUndefined();
  });

  it('без id, суммы или даты — бросает, а не пишет «операцию на ноль»', () => {
    expect(() => ozonOperationToRow(sale({ operation_id: null }), CTX)).toThrow(/operation_id/);
    expect(() => ozonOperationToRow(sale({ amount: 'abc' }), CTX)).toThrow(/без суммы/);
    expect(() => ozonOperationToRow(sale({ operation_date: '' }), CTX)).toThrow(/без даты/);
  });

  it('ключ — id и сумма: та же операция — тот же ключ, пересчёт суммы — другой', () => {
    expect(ozonOperationToRow(sale(), CTX).operationKey).toBe(
      ozonOperationToRow(sale(), { ...CTX, documentId: 'doc-2', documentVersion: 2 }).operationKey,
    );
    expect(ozonOperationToRow(sale(), CTX).operationKey).not.toBe(
      ozonOperationToRow(sale({ amount: 1449, sale_commission: -301 }), CTX).operationKey,
    );
  });
});

describe('P&L: части одной операции двигают товар один раз', () => {
  it('после expandBreakdown товар — только у строки выручки', () => {
    const op = ozonOperationToRow(sale(), CTX);
    const lines = expandBreakdown([
      {
        id: 'op-1',
        article: op.article,
        amountKopecks: op.amountKopecks,
        breakdown: op.breakdown,
        orderId: op.orderId ?? null,
        sku: op.sku ?? null,
        serviceName: null,
        transactionType: op.transactionType,
        transactionSource: op.transactionSource ?? null,
        accruedAt: op.accruedAt,
        paidAt: null,
        actDate: null,
        model: op.model ?? null,
        count: '1',
        marketplace: 'ozon' as const,
      },
    ]).map(pnlLineOf);
    expect(lines.map((l) => [l.article, l.goods])).toEqual([
      ['sales', 'sold'],
      ['commission', null],
      ['delivery_to_buyer', null],
      ['processing', null],
    ]);
    expect(lines.reduce((sum, l) => sum + l.amountKopecks, 0)).toBe(145000);
  });
});

describe('период и оригинал версии', () => {
  it('операции вне московских дней периода — в dropped', () => {
    const period = { from: '2026-09-01', to: '2026-09-30' };
    const { ops, dropped } = ozonOperationsInPeriod(
      [
        sale(),
        sale({ operation_id: 2, operation_date: '2026-10-01 00:00:00' }),
        sale({ operation_id: 3, operation_date: '2026-08-31T21:00:00Z' }),
        sale({ operation_id: 4, operation_date: '' }),
      ],
      period,
    );
    expect(ops.map((o) => o.operation_id)).toEqual([21600000001, 3]);
    expect(dropped).toBe(2);
  });

  it('одинаковый ответ в другом порядке — те же байты (sha256 → unchanged)', () => {
    const period = { from: '2026-09-01', to: '2026-09-30' };
    const a = sale();
    const b = sale({ operation_id: 7 });
    const reordered = Object.fromEntries(Object.entries(b).reverse());
    expect(
      ozonFinanceOriginal(period, [a, b]).equals(ozonFinanceOriginal(period, [reordered, a])),
    ).toBe(true);
  });
});

describe('алерт о нераспознанном', () => {
  it('один отчёт на загрузку, место без id; нет нераспознанного — без алерта', async () => {
    const report = vi.fn(async () => undefined);
    const unknown = ozonOperationToRow(
      sale({ services: [{ name: 'X', price: -10 }], amount: 1540 }),
      CTX,
    );
    expect(await reportOzonUnknownArticles({ report }, [unknown, unknown], '111')).toBe(2);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: OZON_UNKNOWN_ARTICLE_CONTEXT, telegramUserId: '111' }),
    );

    report.mockClear();
    expect(
      await reportOzonUnknownArticles({ report }, [ozonOperationToRow(sale(), CTX)], '111'),
    ).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('части — сумма составляющих, остаток не теряется', () => {
    const parts = ozonOperationParts(sale({ services: [] }), 155000);
    expect(parts.reduce((sum, p) => sum + p.kopecks, 0)).toBe(155000);
  });
});
