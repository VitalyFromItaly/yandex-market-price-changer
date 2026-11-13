import type { ITestFinanceDb } from '../helpers/test-postgres';
import type {
  IAccountingOrderLineValue,
  IOzonPostingRaw,
  IWbOrderRowRaw,
  IWbSaleRowRaw,
  IYmOrderRaw,
} from '../../src/modules/accounting/accounting-order-lines.domain';
import type { IMarketplaceRawOrderLine } from '../../src/modules/marketplaces/marketplace-adapter';
import type { IReturnRecord } from '../../src/modules/yandex/yandex-api.client';

import { createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AccountingOrderLineRepository } from '../../src/database/postgres/repositories/accounting-order-line.repository';
import {
  ORDER_LINES_MAX_DAYS,
  lineFingerprint,
  lineValueOf,
  orderLinesDue,
  orderLinesWindow,
  ozonOrderLines,
  ozonOrderLinesWindow,
  wbOrderLine,
  ymInstanceCondition,
  ymReasonDamaged,
  ymOrderLines,
  ymReturnConditions,
} from '../../src/modules/accounting/accounting-order-lines.domain';
import {
  AccountingOrdersService,
  AccountingOrdersSyncError,
} from '../../src/modules/accounting/accounting-orders.service';
import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { orderTotals } from '../../src/modules/yandex/reports/money';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { JOB_TYPES } from '../../src/modules/telegram/index';
import {
  accountingOrdersCron,
  accountingOrdersJobId,
  parseAccountingOrdersJobId,
  pickAccountingOrdersUsers,
} from '../../src/modules/telegram/queue/services/accounting-orders-schedule';
import { AccountingOrdersScheduler } from '../../src/modules/telegram/queue/services/accounting-orders.scheduler';
import { createTestFinanceDb } from '../helpers/test-postgres';

/** Заказ по форме живого OrderDTO: позиция ×2 с субсидиями на единицу и акцией продавца. */
function order(over: Partial<IYmOrderRaw> = {}): IYmOrderRaw {
  return {
    id: 58841189889,
    status: 'DELIVERED',
    substatus: 'DELIVERY_SERVICE_DELIVERED',
    creationDate: '01-11-2026 21:15:00',
    updatedAt: '05-11-2026 10:00:00',
    delivery: { dates: { toDate: '04-11-2026', realDeliveryDate: '04-11-2026' } },
    items: [
      {
        id: 101,
        offerId: 'TQ-141-1D',
        offerName: 'Часы',
        count: 2,
        price: 4000,
        buyerPrice: 3159,
        buyerPriceBeforeDiscount: 4500,
        subsidies: [
          { type: 'YANDEX_CASHBACK', amount: 276 },
          { type: 'SUBSIDY', amount: 565 },
          { type: 'DELIVERY', amount: 99 },
        ],
        promos: [{ subsidy: 100 }],
      },
      { id: 102, offerId: 'B-2', offerName: 'Ремешок', count: 1, price: 500, buyerPrice: 500 },
    ],
    ...over,
  };
}

describe('ymOrderLines — строки заказа ЯМ', () => {
  it('цена продавца, платёж покупателя, субсидии без DELIVERY на единицу, скидка продавца', () => {
    const [watch, strap] = ymOrderLines(order(), '148655119');
    expect(watch).toMatchObject({
      marketplace: 'ym',
      orderId: '58841189889',
      itemId: '101',
      campaignId: '148655119',
      offerId: 'TQ-141-1D',
      count: 2,
      priceKopecks: 400000,
      buyerPriceKopecks: 315900,
      buyerPriceBeforeDiscountKopecks: 450000,
      marketplaceSubsidyKopecks: 84100,
      // (4500 − 3159) − 100 = 1241 ₽ на единицу.
      sellerDiscountKopecks: 124100,
      revenueKopecks: (315900 + 84100) * 2,
      status: 'DELIVERED',
      createdOn: '2026-11-01',
      soldOn: '2026-11-04',
      deliveryOn: '2026-11-04',
      returnedOn: null,
      source: 'ym-orders',
    });
    expect(strap).toMatchObject({
      itemId: '102',
      marketplaceSubsidyKopecks: 0,
      sellerDiscountKopecks: null,
      revenueKopecks: 50000,
    });
  });

  it('Σ выручки строк = orderTotals().sales заказа (одна семантика «Продаж»)', () => {
    const raw = {
      ...order(),
      itemsTotal: 3159 * 2 + 500,
      subsidies: [
        { type: 'YANDEX_CASHBACK', amount: 552 },
        { type: 'SUBSIDY', amount: 1130 },
        { type: 'DELIVERY', amount: 99 },
      ],
    };
    const lines = ymOrderLines(raw, '1');
    const sum = lines.reduce((acc, line) => acc + (line.revenueKopecks ?? 0), 0);
    expect(sum).toBe(Math.round(orderTotals(raw).sales * 100));
  });

  it('неизвестная цена — null, не 0; позиция без id и заказ без id не пишутся', () => {
    const [line] = ymOrderLines(
      order({
        items: [
          { id: 1, count: 1 },
          { offerId: 'no-id', count: 1 },
        ],
      }),
      '1',
    );
    expect(line.priceKopecks).toBeNull();
    expect(line.buyerPriceKopecks).toBeNull();
    expect(line.revenueKopecks).toBeNull();
    expect(ymOrderLines(order({ items: [{ offerId: 'x' }] }), '1')).toHaveLength(0);
    expect(ymOrderLines(order({ id: undefined }), '1')).toEqual([]);
  });

  it('возврат — день возврата, не день продажи; в пути — ни того ни другого', () => {
    const [returned] = ymOrderLines(order({ status: 'RETURNED', substatus: undefined }), '1');
    expect(returned.returnedOn).toBe('2026-11-05');
    expect(returned.soldOn).toBeNull();
    const [transit] = ymOrderLines(order({ status: 'DELIVERY', substatus: undefined }), '1');
    expect(transit.soldOn).toBeNull();
    expect(transit.returnedOn).toBeNull();
  });

  it('отпечаток меняется от цены и статуса и не зависит от порядка ключей', () => {
    const [line] = ymOrderLines(order(), '1');
    expect(lineFingerprint({ ...line })).toBe(lineFingerprint(line));
    expect(lineFingerprint({ ...line, priceKopecks: 1 })).not.toBe(lineFingerprint(line));
    expect(lineFingerprint({ ...line, status: 'RETURNED' })).not.toBe(lineFingerprint(line));
  });

  it('состояние возврата: null не входит в отпечаток, значение и его смена — входят', () => {
    const [line] = ymOrderLines(order(), '1');
    expect(line.returnCondition).toBeNull();
    const { returnCondition: _drop, ...before } = line;
    expect(lineFingerprint(line)).toBe(lineFingerprint(before as typeof line));
    const fit = lineFingerprint({ ...line, returnCondition: 'fit' });
    expect(fit).not.toBe(lineFingerprint(line));
    expect(lineFingerprint({ ...line, returnCondition: 'damaged' })).not.toBe(fit);
  });

  it('состояние ставится только вернувшейся позиции, по артикулу', () => {
    const conditions = new Map([['TQ-141-1D', 'damaged' as const]]);
    const [returned] = ymOrderLines(
      order({ status: 'RETURNED', substatus: undefined }),
      '1',
      conditions,
    );
    expect(returned.returnCondition).toBe('damaged');
    const [delivered] = ymOrderLines(order(), '1', conditions);
    expect(delivered.returnCondition).toBeNull();
    const [unmatched] = ymOrderLines(order({ status: 'RETURNED', substatus: undefined }), '1');
    expect(unmatched.returnCondition).toBeNull();
  });
});

describe('ymReturnConditions — состояние возврата ЯМ из instances', () => {
  const ret = (over: Partial<IReturnRecord>): IReturnRecord => ({
    returnId: 1,
    orderId: 500,
    shipmentStatus: 'PICKED',
    refundStatus: 'REFUNDED',
    raw: {},
    ...over,
  });

  it('экземпляр: FIT → fit, брак/просрочка/аномалия → damaged, LOST/UTILIZED → lost, нет данных → unknown', () => {
    expect(ymInstanceCondition({ stockType: 'FIT', status: 'PICKED' })).toBe('fit');
    for (const stockType of ['DEFECT', 'EXPIRED', 'ANOMALY', 'MISGRADING', 'PART_MISSING']) {
      expect(ymInstanceCondition({ stockType })).toBe('damaged');
    }
    expect(ymInstanceCondition({ stockType: 'FIT', status: 'LOST' })).toBe('lost');
    expect(ymInstanceCondition({ stockType: 'DEFECT', status: 'UTILIZED' })).toBe('lost');
    expect(ymInstanceCondition({})).toBe('unknown');
    expect(ymInstanceCondition({ stockType: 'UNDEFINED' })).toBe('unknown');
    expect(ymInstanceCondition({ stockType: 'FIT', status: 'CANCELLED' })).toBeNull();
  });

  it('позиция берёт худшее из экземпляров и возвратов; без instances — unknown', () => {
    const map = ymReturnConditions([
      ret({
        items: [
          { offerId: 'A', instances: [{ stockType: 'FIT' }, { stockType: 'DEFECT' }] },
          { offerId: 'B', instances: [{ stockType: 'FIT' }] },
          { offerId: 'C' },
        ],
      }),
      ret({ returnId: 2, items: [{ offerId: 'B', instances: [{ status: 'LOST' }] }] }),
      ret({
        returnId: 3,
        orderId: 501,
        items: [{ offerId: 'A', instances: [{ stockType: 'FIT' }] }],
      }),
    ]);
    expect(Object.fromEntries(map.get('500') ?? [])).toEqual({
      A: 'damaged',
      B: 'lost',
      C: 'unknown',
    });
    expect(Object.fromEntries(map.get('501') ?? [])).toEqual({ A: 'fit' });
  });

  it('мёртвая заявка и отменённые экземпляры не считаются', () => {
    const map = ymReturnConditions([
      ret({
        shipmentStatus: 'CREATED',
        refundStatus: 'CANCELLED',
        items: [{ offerId: 'A', instances: [{ stockType: 'DEFECT' }] }],
      }),
      ret({
        orderId: 501,
        items: [{ offerId: 'A', instances: [{ stockType: 'DEFECT', status: 'CANCELLED' }] }],
      }),
    ]);
    expect(map.size).toBe(0);
  });

  it('причина покупателя (TASK-241): брак поднимает только unknown до damaged', () => {
    const bad = [{ reasonType: 'BAD_QUALITY', subreasonType: 'BROKEN' }];
    const map = ymReturnConditions([
      ret({
        items: [
          // FBS: stockType нет, только status — как на живом магазине
          { offerId: 'A', instances: [{ status: 'PICKED' }], decisions: bad },
          {
            offerId: 'B',
            instances: [{ status: 'PICKED' }],
            decisions: [{ reasonType: 'DOES_NOT_FIT' }],
          },
          { offerId: 'C', instances: [{ stockType: 'FIT' }], decisions: bad },
          { offerId: 'D', instances: [{ status: 'LOST' }], decisions: bad },
          { offerId: 'E', decisions: [{ reasonType: 'WRONG_ITEM' }] },
          { offerId: 'F', instances: [{}], decisions: [{ reasonType: 'damage_delivery' }] },
          {
            offerId: 'G',
            instances: [{ status: 'PICKED' }],
            decisions: [{ reasonType: 'UNKNOWN' }],
          },
        ],
      }),
    ]);
    expect(Object.fromEntries(map.get('500') ?? [])).toEqual({
      A: 'damaged',
      B: 'unknown',
      C: 'fit',
      D: 'lost',
      E: 'damaged',
      F: 'damaged',
      G: 'unknown',
    });
  });

  it('ymReasonDamaged: BAD_QUALITY / DAMAGE_DELIVERY / WRONG_ITEM — брак, прочее и пусто — нет', () => {
    for (const reasonType of ['BAD_QUALITY', 'DAMAGE_DELIVERY', 'WRONG_ITEM']) {
      expect(ymReasonDamaged([{ reasonType: 'DOES_NOT_FIT' }, { reasonType }])).toBe(true);
    }
    for (const reasonType of [
      'DOES_NOT_FIT',
      'LOYALTY_FAIL',
      'CONTENT_FAIL',
      'DELIVERY_FAIL',
      'UNKNOWN',
    ]) {
      expect(ymReasonDamaged([{ reasonType }])).toBe(false);
    }
    expect(ymReasonDamaged(undefined)).toBe(false);
    expect(ymReasonDamaged([{}])).toBe(false);
  });

  it('FBS-возврат с BAD_QUALITY даёт damaged в строке заказа без ручного пересчёта', () => {
    const conditions = ymReturnConditions([
      ret({
        orderId: 58841189889,
        items: [
          {
            offerId: 'TQ-141-1D',
            instances: [{ status: 'PICKED' }],
            decisions: [{ reasonType: 'BAD_QUALITY' }],
          },
        ],
      }),
    ]);
    const [line] = ymOrderLines(
      order({ status: 'RETURNED', substatus: undefined }),
      '1',
      conditions.get('58841189889'),
    );
    expect(line.returnCondition).toBe('damaged');
  });
});

describe('orderLinesWindow — окно updatedAt', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;

  it('первый опрос — 7 дней', () => {
    expect(orderLinesWindow(null, now)).toEqual({
      from: new Date(now.getTime() - 7 * day),
      to: now,
    });
  });

  it('дальше — от курсора с нахлёстом 30 минут', () => {
    const cursor = new Date('2026-11-08T11:45:00Z');
    expect(orderLinesWindow(cursor, now).from).toEqual(new Date('2026-11-08T11:15:00Z'));
  });

  it('давний курсор упирается в предел API', () => {
    const old = new Date('2026-08-01T00:00:00Z');
    expect(orderLinesWindow(old, now).from).toEqual(
      new Date(now.getTime() - ORDER_LINES_MAX_DAYS * day),
    );
  });
});

/** Отправление по форме FBS v4 с `with.financial_data` (строится как в ozon-orders.test). */
function posting(over: Partial<IOzonPostingRaw> = {}): IOzonPostingRaw {
  return {
    posting_number: 'P-1',
    status: 'delivered',
    substatus: 'posting_delivered',
    in_process_at: '2026-11-01T21:30:00Z',
    shipment_date: '2026-11-03T10:00:00Z',
    products: [
      {
        sku: 555,
        offer_id: 'A',
        name: 'Часы',
        quantity: 2,
        price: { amount: '1990.50', currency: 'RUB' },
      },
    ],
    financial_data: {
      products: [
        {
          product_id: 555,
          price: 1990.5,
          old_price: 2500,
          customer_price: { amount: '1700', currency: 'RUB' },
          payout: 1500.25,
          commission: { amount: 300, currency: 'RUB' },
        },
      ],
    },
    ...over,
  };
}

/** Строка supplier/orders (как в wb-orders.test). */
function wbOrder(over: Partial<IWbOrderRowRaw> = {}): IWbOrderRowRaw {
  return {
    srid: 'S-1',
    date: '2026-11-01T21:30:00',
    lastChangeDate: '2026-11-02T10:00:00',
    supplierArticle: 'A-1',
    nmId: 777,
    subject: 'Часы',
    totalPrice: 3000,
    priceWithDisc: 1990.5,
    finishedPrice: 1800,
    isCancel: false,
    ...over,
  };
}

function wbSale(saleID: string, over: Partial<IWbSaleRowRaw> = {}): IWbSaleRowRaw {
  return { ...wbOrder(), saleID, date: '2026-11-05T12:00:00', forPay: 1600.4, ...over };
}

describe('ozonOrderLines — строки отправления Ozon', () => {
  it('цена покупателя, цена продавца, к признанию и выплата — раздельно', () => {
    const [line] = ozonOrderLines(posting());
    expect(line).toMatchObject({
      marketplace: 'ozon',
      orderId: 'P-1',
      itemId: '555',
      campaignId: null,
      offerId: 'A',
      count: 2,
      priceKopecks: 199050,
      buyerPriceKopecks: 170000,
      buyerPriceBeforeDiscountKopecks: 250000,
      sellerDiscountKopecks: 50950,
      revenueKopecks: 398100,
      payoutKopecks: 150025,
      commissionKopecks: 30000,
      marketplaceSubsidyKopecks: 29050,
      createdOn: '2026-11-02',
      deliveryOn: '2026-11-03',
      soldOn: null,
      returnedOn: null,
      source: 'ozon-postings',
    });
  });

  it('без financial_data — цена товара отправления, остальное null, а не 0', () => {
    const [line] = ozonOrderLines(posting({ financial_data: null }));
    expect(line).toMatchObject({
      priceKopecks: 199050,
      revenueKopecks: 398100,
      buyerPriceKopecks: null,
      buyerPriceBeforeDiscountKopecks: null,
      sellerDiscountKopecks: null,
      payoutKopecks: null,
      commissionKopecks: null,
    });
  });

  it('выплата и комиссия 0 до доставки — null, а не 0 рублей', () => {
    const base = posting();
    const money = { ...base.financial_data.products[0], payout: 0, commission: { amount: 0 } };
    const [line] = ozonOrderLines(posting({ financial_data: { products: [money] } }));
    expect(line).toMatchObject({ payoutKopecks: null, commissionKopecks: null });
  });

  it('нет customer_price — цена покупателя null; без номера или sku — строк нет', () => {
    const base = posting();
    const money = { ...base.financial_data.products[0], customer_price: undefined };
    const [line] = ozonOrderLines(posting({ financial_data: { products: [money] } }));
    expect(line.buyerPriceKopecks).toBeNull();
    expect(ozonOrderLines(posting({ posting_number: '' }))).toEqual([]);
    expect(ozonOrderLines(posting({ products: [{ offer_id: 'A', quantity: 1 }] }))).toEqual([]);
  });
});

describe('wbOrderLine — штука WB', () => {
  it('заказ без продажи — ordered; СПП — субсидия площадки', () => {
    expect(wbOrderLine(wbOrder(), null)).toMatchObject({
      marketplace: 'wb',
      orderId: 'S-1',
      itemId: '777',
      campaignId: null,
      count: 1,
      priceKopecks: 199050,
      buyerPriceKopecks: 180000,
      buyerPriceBeforeDiscountKopecks: 300000,
      marketplaceSubsidyKopecks: 19050,
      sellerDiscountKopecks: 100950,
      revenueKopecks: 199050,
      payoutKopecks: null,
      status: 'ordered',
      createdOn: '2026-11-01',
      soldOn: null,
      source: 'wb-statistics',
    });
  });

  it('выкуп S — день выкупа и выплата; возврат R — returned; отмена — cancelled', () => {
    expect(wbOrderLine(wbOrder(), wbSale('S1'))).toMatchObject({
      status: 'sold',
      soldOn: '2026-11-05',
      payoutKopecks: 160040,
    });
    expect(wbOrderLine(wbOrder(), wbSale('R1', { forPay: -1600.4 }))).toMatchObject({
      status: 'returned',
      returnedOn: '2026-11-05',
      payoutKopecks: null,
    });
    expect(wbOrderLine(wbOrder({ isCancel: true }), null)?.status).toBe('cancelled');
  });

  it('продажа без заказа ложится поверх сохранённой строки', () => {
    const stored = wbOrderLine(wbOrder(), null);
    const line = wbOrderLine(null, wbSale('S1', { priceWithDisc: 1 }), lineValueOf(stored));
    expect(line).toMatchObject({
      priceKopecks: 199050,
      createdOn: '2026-11-01',
      status: 'sold',
      soldOn: '2026-11-05',
      payoutKopecks: 160040,
    });
  });

  it('ни заказа, ни сохранённой строки — цены из продажи, день оформления null', () => {
    expect(wbOrderLine(null, wbSale('S1'))).toMatchObject({
      priceKopecks: 199050,
      createdOn: null,
      status: 'sold',
    });
  });

  it('нет finishedPrice — цена покупателя и СПП null, а не 0', () => {
    expect(wbOrderLine(wbOrder({ finishedPrice: undefined }), null)).toMatchObject({
      buyerPriceKopecks: null,
      marketplaceSubsidyKopecks: null,
    });
  });
});

describe('отпечаток и окна Ozon/WB', () => {
  it('строка ЯМ без выплаты, комиссии и состояния возврата — тот же отпечаток, что до TASK-211', () => {
    const [line] = ymOrderLines(order(), '1');
    const value = lineValueOf(line) as Partial<IAccountingOrderLineValue>;
    delete value.payoutKopecks;
    delete value.commissionKopecks;
    delete value.returnCondition;
    const before = Object.keys(value)
      .sort()
      .map((key) => [key, value[key as keyof IAccountingOrderLineValue] ?? null]);
    expect(lineFingerprint(line)).toBe(
      createHash('sha1').update(JSON.stringify(before)).digest('hex'),
    );
    expect(lineFingerprint({ ...line, payoutKopecks: 100 })).not.toBe(lineFingerprint(line));
  });

  it('Ozon — всегда 29 дней; Ozon/WB не чаще раза в час, ЯМ — каждый проход', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    expect(ozonOrderLinesWindow(now).from).toEqual(new Date('2026-10-10T12:00:00Z'));
    const tenMinutes = new Date(now.getTime() - 10 * 60 * 1000);
    expect(orderLinesDue('ym', tenMinutes, now)).toBe(true);
    expect(orderLinesDue('wb', tenMinutes, now)).toBe(false);
    expect(orderLinesDue('ozon', new Date('2026-11-08T11:00:00Z'), now)).toBe(true);
    expect(orderLinesDue('wb', null, now)).toBe(true);
  });
});

describe('расписание снимка строк заказов', () => {
  const OPEN = { [FEATURE.FIN_ACCOUNTING]: true };

  it('id задачи с дефисом и разбор только цифр', () => {
    expect(accountingOrdersJobId('42')).toBe('accorders-42');
    expect(parseAccountingOrdersJobId('accorders-42')).toBe('42');
    expect(parseAccountingOrdersJobId('accorders-')).toBeNull();
    expect(parseAccountingOrdersJobId('finacc-42')).toBeNull();
  });

  it('cron раз в 15 минут со сдвигом от id, сдвиг стабилен', () => {
    const cron = accountingOrdersCron('309809755', 15);
    expect(cron).toMatch(/^([0-9]|1[0-4])-59\/15 \* \* \* \*$/);
    expect(accountingOrdersCron('309809755', 15)).toBe(cron);
    expect(accountingOrdersCron('1', 60)).toMatch(/^\d+ \* \* \* \*$/);
    expect(accountingOrdersCron('1', 7)).toMatch(/\/10 /);
  });

  it('только одобренные с fin_accounting и настроенным ЯМ; админов нет', () => {
    const accounts = [
      { telegramUserId: '1', status: 'approved', features: OPEN },
      { telegramUserId: '2', status: 'approved', features: {} },
      { telegramUserId: '3', status: 'pending', features: OPEN },
      { telegramUserId: '4', status: 'approved', features: OPEN },
    ];
    const picked = pickAccountingOrdersUsers(accounts, {
      ym: new Set(['1', '2', '3']),
      ozon: new Set(),
      wb: new Set(),
    });
    expect([...picked.entries()]).toEqual([['1', ['ym']]]);
  });

  it('Ozon и WB — с фичей площадки и подключённым ключом', () => {
    const accounts = [
      {
        telegramUserId: '1',
        status: 'approved',
        features: { ...OPEN, [FEATURE.OZON]: true, [FEATURE.WB]: true },
      },
      { telegramUserId: '2', status: 'approved', features: OPEN },
      { telegramUserId: '3', status: 'approved', features: { [FEATURE.OZON]: true } },
    ];
    const picked = pickAccountingOrdersUsers(accounts, {
      ym: new Set(),
      ozon: new Set(['1', '2', '3']),
      wb: new Set(['1']),
    });
    expect(picked.get('1')).toEqual(['ozon', 'wb']);
    // Без фичи площадки ключ не в счёт; без fin_accounting — никого.
    expect(picked.has('2')).toBe(false);
    expect(picked.has('3')).toBe(false);
  });

  it('сверка заводит задачу без токена в payload и снимает лишние', async () => {
    const queue = {
      getRepeatableJobs: vi.fn(async () => [
        { id: 'accorders-9', key: 'k9', cron: '1 * * * *' },
        { id: 'finacc-1', key: 'other', cron: '1 */3 * * *' },
      ]),
      removeRepeatableByKey: vi.fn(async () => undefined),
      add: vi.fn(async () => undefined),
    };
    const access = {
      list: vi.fn(async () => [{ telegramUserId: '1', status: 'approved', features: OPEN }]),
    };
    const stores = {
      findByTelegramUsers: vi.fn(async () => [
        { telegramUserId: '1', campaign_id: 11, business_id: 22, token: 'secret' },
      ]),
    };
    const connections = { connectedUsers: vi.fn(async () => new Set<string>()) };
    const scheduler = new AccountingOrdersScheduler(
      queue as never,
      access as never,
      stores as never,
      { finAccountingOrdersEveryMinutes: 15 } as never,
      { report: vi.fn() } as never,
      connections as never,
    );
    expect(await scheduler.reconcile()).toEqual({ added: 1, removed: 1 });
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('k9');
    expect(queue.add).toHaveBeenCalledWith(
      JOB_TYPES.SYNC_ACCOUNTING_ORDERS,
      { telegramUserId: '1', scheduled: true },
      expect.objectContaining({ jobId: 'accorders-1', attempts: 1 }),
    );
    expect(JSON.stringify(queue.add.mock.calls)).not.toContain('secret');
  });
});

describe('снимок строк в Postgres (PGlite)', () => {
  let fin: ITestFinanceDb;
  let repo: AccountingOrderLineRepository;

  beforeAll(async () => {
    fin = await createTestFinanceDb();
    repo = new AccountingOrderLineRepository(fin.db);
  });
  afterEach(async () => fin.reset());
  afterAll(async () => fin.close());

  it('первый прогон — версия 1; повтор без изменений — без новых версий', async () => {
    const lines = ymOrderLines(order(), '1');
    expect(await repo.upsertLines('u1', lines, new Date('2026-11-08T10:00:00Z'))).toEqual({
      seen: 2,
      created: 2,
      changed: 0,
    });
    expect(await repo.upsertLines('u1', lines, new Date('2026-11-08T10:15:00Z'))).toEqual({
      seen: 2,
      created: 0,
      changed: 0,
    });
    const [watch] = await repo.linesOf('u1', '58841189889');
    expect(watch.version).toBe(1);
    expect(watch.lastSeenAt).toEqual(new Date('2026-11-08T10:15:00Z'));
    expect(watch.changedAt).toEqual(new Date('2026-11-08T10:00:00Z'));
    expect(await repo.versionsOf('u1', watch.id)).toHaveLength(1);
  });

  it('смена статуса — версия 2, версия 1 сохраняется с прежней ценой', async () => {
    await repo.upsertLines(
      'u1',
      ymOrderLines(order({ status: 'DELIVERY', substatus: undefined }), '1'),
    );
    const changed = order();
    changed.items = [{ ...changed.items[0], price: 4200 }, changed.items[1]];
    expect(await repo.upsertLines('u1', ymOrderLines(changed, '1'))).toMatchObject({ changed: 2 });

    const [watch] = await repo.linesOf('u1', '58841189889');
    expect(watch).toMatchObject({ version: 2, status: 'DELIVERED', priceKopecks: 420000 });
    const versions = await repo.versionsOf('u1', watch.id);
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
    expect(versions[0].value).toMatchObject({ status: 'DELIVERY', priceKopecks: 400000 });
  });

  it('продавцы изолированы, дубль позиции в пачке не плодит версий', async () => {
    const lines = ymOrderLines(order(), '1');
    await repo.upsertLines('u1', [...lines, ...lines]);
    await repo.upsertLines('u2', lines);
    expect(await repo.linesOf('u1', '58841189889')).toHaveLength(2);
    expect(await repo.linesOf('u2', '58841189889')).toHaveLength(2);
    const [watch] = await repo.linesOf('u1', '58841189889');
    expect(await repo.versionsOf('u1', watch.id)).toHaveLength(1);
    expect(await repo.versionsOf('u2', watch.id)).toHaveLength(0);
  });

  describe('AccountingOrdersService', () => {
    const store = {
      telegramUserId: 'u1',
      token: 'secret',
      campaign_id: 11,
      business_id: 22,
      stores: [
        { campaignId: 11, businessId: 22 },
        { campaignId: 12, businessId: 22 },
        { campaignId: 99, businessId: 77 },
      ],
    };

    function service(
      pages: Record<string, IYmOrderRaw[][]>,
      found: unknown = store,
      raw: Partial<Record<'ozon' | 'wb', () => Promise<IMarketplaceRawOrderLine[]>>> = {},
      returns: Record<string, IReturnRecord[]> = {},
    ) {
      const queries: unknown[] = [];
      const returnQueries: unknown[] = [];
      const clients = {
        forTenant: vi.fn(({ campaignId }: { campaignId: string }) => ({
          campaignId,
          async *iterateOrders(query: unknown) {
            queries.push(query);
            if (pages[campaignId] === undefined) throw new Error('Маркет недоступен');
            yield* pages[campaignId];
          },
          async *iterateReturns(query: unknown) {
            returnQueries.push(query);
            if (returns[campaignId]?.length) yield returns[campaignId];
          },
        })),
        forStore: vi.fn(),
      };
      const stores = { findByTelegramUser: vi.fn(async () => found) };
      const windows: { marketplace: string; from: Date; to: Date }[] = [];
      const registry = {
        capability: vi.fn((marketplace: 'ozon' | 'wb') =>
          raw[marketplace]
            ? {
                rawOrderLines: async (_ref: unknown, window: { from: Date; to: Date }) => {
                  windows.push({ marketplace, ...window });
                  return await raw[marketplace]();
                },
              }
            : null,
        ),
      };
      return {
        svc: new AccountingOrdersService(
          stores as never,
          clients as never,
          repo,
          registry as never,
        ),
        clients,
        queries,
        returnQueries,
        windows,
      };
    }

    it('возвраты окна ставят состояние: в заказе окна, поверх сохранённой строки, повтор не стирает', async () => {
      const now = new Date('2026-11-08T12:00:00Z');
      const returned = order({ status: 'RETURNED', substatus: undefined });
      const defect: IReturnRecord = {
        orderId: returned.id as number,
        shipmentStatus: 'PICKED',
        items: [{ offerId: 'TQ-141-1D', instances: [{ stockType: 'DEFECT' }] }],
        raw: {},
      };
      const first = service({ '11': [[returned]], '12': [[]] }, store, {}, { '11': [defect] });
      await first.svc.syncUser('u1', { now });
      expect(first.returnQueries[0]).toEqual({ fromDate: '2026-11-01', toDate: '2026-11-08' });
      const [line] = await repo.linesOf('u1', String(returned.id));
      expect(line.returnCondition).toBe('damaged');

      // Заказ обновился снова, возврата в окне нет — состояние остаётся.
      await service({
        '11': [[{ ...returned, updatedAt: '08-11-2026 15:00:00' }]],
        '12': [[]],
      }).svc.syncUser('u1', { now: new Date('2026-11-08T13:00:00Z') });
      expect((await repo.linesOf('u1', String(returned.id)))[0].returnCondition).toBe('damaged');

      // Возврат обновился без заказа — сохранённая строка получает новое состояние и версию.
      const lost = {
        ...defect,
        items: [{ offerId: 'TQ-141-1D', instances: [{ status: 'LOST' }] }],
      };
      await service({ '11': [[]], '12': [[]] }, store, {}, { '12': [lost] }).svc.syncUser('u1', {
        now: new Date('2026-11-08T14:00:00Z'),
      });
      const [after] = await repo.linesOf('u1', String(returned.id));
      expect(after.returnCondition).toBe('lost');
      const versions = await repo.versionsOf('u1', after.id);
      expect(versions.map((v) => v.value.returnCondition ?? null)).toEqual([
        'damaged',
        'damaged',
        'lost',
      ]);
    });

    it('все магазины кабинета, курсор и последний успех; второй прогон — unchanged', async () => {
      const now = new Date('2026-11-08T12:00:00Z');
      const { svc, clients, queries } = service({ '11': [[order()]], '12': [[]] });
      const first = (await svc.syncUser('u1', { now })).results.ym;
      expect(first).toMatchObject({ outcome: 'imported', campaigns: 2, orders: 1, created: 2 });
      expect(clients.forTenant.mock.calls.map(([arg]) => arg.campaignId)).toEqual(['11', '12']);
      expect(queries[0]).toEqual({
        updatedAtFrom: '2026-11-01T12:00:00.000Z',
        updatedAtTo: '2026-11-08T12:00:00.000Z',
      });

      const later = new Date('2026-11-08T12:15:00Z');
      const second = (await svc.syncUser('u1', { now: later })).results.ym;
      expect(second).toMatchObject({ outcome: 'unchanged', created: 0, changed: 0 });
      expect(queries[2]).toMatchObject({ updatedAtFrom: '2026-11-08T11:30:00.000Z' });
      expect(await repo.syncState('u1', 'ym')).toMatchObject({
        lastOutcome: 'unchanged',
        lastSuccessAt: later,
        cursorAt: later,
        versionsWritten: 0,
      });
    });

    it('магазин не настроен — not-connected без исключения и без курсора', async () => {
      const { svc } = service({}, null);
      expect((await svc.syncUser('u1')).results.ym).toMatchObject({ outcome: 'not-connected' });
      expect(await repo.syncState('u1', 'ym')).toMatchObject({
        lastOutcome: 'not-connected',
        cursorAt: null,
      });
    });

    it('сбой — пишет failed, последний успех и курсор прежние, ошибка пробрасывается', async () => {
      const ok = new Date('2026-11-08T12:00:00Z');
      await service({ '11': [[]], '12': [[]] }).svc.syncUser('u1', { now: ok });
      const { svc } = service({ '11': [[]] });
      await expect(svc.syncUser('u1', { now: new Date('2026-11-08T12:15:00Z') })).rejects.toThrow(
        'Маркет недоступен',
      );
      expect(await repo.syncState('u1', 'ym')).toMatchObject({
        lastOutcome: 'failed',
        lastError: 'Маркет недоступен',
        lastSuccessAt: ok,
        cursorAt: ok,
      });
    });
    it('Ozon и WB пишут строки; повтор через час — unchanged, через 10 минут — skipped', async () => {
      const now = new Date('2026-11-08T12:00:00Z');
      const { svc, windows } = service({ '11': [[]], '12': [[]] }, store, {
        ozon: async () => [{ kind: 'ozon-fbs', raw: posting() }],
        wb: async () => [
          { kind: 'wb-order', raw: wbOrder() },
          { kind: 'wb-sale', raw: wbSale('S1') },
          { kind: 'wb-sale', raw: wbSale('R1') },
          { kind: 'wb-sale', raw: wbSale('S2') },
        ],
      });
      const all = ['ym', 'ozon', 'wb'] as const;
      const first = await svc.syncUser('u1', { now, marketplaces: all });
      expect(first.results.ozon).toMatchObject({ outcome: 'imported', orders: 1, created: 1 });
      expect(first.results.wb).toMatchObject({ outcome: 'imported', orders: 4, created: 1 });
      expect(windows.find((w) => w.marketplace === 'ozon')?.from).toEqual(
        new Date('2026-10-10T12:00:00Z'),
      );
      expect(windows.find((w) => w.marketplace === 'wb')?.from).toEqual(
        new Date('2026-11-01T12:00:00Z'),
      );
      // Возврат окончателен: поздний S2 его не перекрыл.
      const [wb] = await repo.linesOf('u1', 'S-1', 'wb');
      expect(wb).toMatchObject({ status: 'returned', returnedOn: '2026-11-05', campaignId: null });
      const [ozon] = await repo.linesOf('u1', 'P-1', 'ozon');
      expect(ozon).toMatchObject({ payoutKopecks: 150025, buyerPriceKopecks: 170000 });

      const soon = await svc.syncUser('u1', {
        now: new Date('2026-11-08T12:10:00Z'),
        marketplaces: all,
      });
      expect(soon.results.ozon).toEqual({ outcome: 'skipped' });
      expect(soon.results.wb).toEqual({ outcome: 'skipped' });
      expect(soon.results.ym).toMatchObject({ outcome: 'unchanged' });

      const hour = await svc.syncUser('u1', {
        now: new Date('2026-11-08T13:00:00Z'),
        marketplaces: all,
      });
      expect(hour.results.ozon).toMatchObject({ outcome: 'unchanged', created: 0, changed: 0 });
      expect(hour.results.wb).toMatchObject({ outcome: 'unchanged' });
    });

    it('продажа WB без заказа в окне ложится поверх сохранённой строки', async () => {
      const now = new Date('2026-11-08T12:00:00Z');
      await repo.upsertLines('u1', [wbOrderLine(wbOrder(), null)], now);
      const { svc } = service({}, null, {
        wb: async () => [{ kind: 'wb-sale', raw: wbSale('S1') }],
      });
      const report = await svc.syncUser('u1', { now, marketplaces: ['wb'] });
      expect(report.results.wb).toMatchObject({ changed: 1 });
      const [line] = await repo.linesOf('u1', 'S-1', 'wb');
      expect(line).toMatchObject({ status: 'sold', createdOn: '2026-11-01', version: 2 });
    });

    it('сбой WB не мешает ЯМ и Ozon; состояние WB — failed, ошибка после прохода', async () => {
      const now = new Date('2026-11-08T12:00:00Z');
      const { svc } = service({ '11': [[order()]], '12': [[]] }, store, {
        ozon: async () => [{ kind: 'ozon-fbo', raw: posting() }],
        wb: async () => {
          throw new Error('WB 429');
        },
      });
      const error = await svc
        .syncUser('u1', { now, marketplaces: ['wb', 'ym', 'ozon'] })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccountingOrdersSyncError);
      expect((error as Error).message).toContain('wb — WB 429');
      const { report } = error as AccountingOrdersSyncError;
      expect(report.results.ym).toMatchObject({ outcome: 'imported', created: 2 });
      expect(report.results.ozon).toMatchObject({ outcome: 'imported', created: 1 });
      expect(await repo.syncState('u1', 'wb')).toMatchObject({
        lastOutcome: 'failed',
        lastError: 'WB 429',
        cursorAt: null,
      });
      expect(await repo.linesOf('u1', 'P-1', 'ozon')).toHaveLength(1);
    });

    it('ключа нет — not-connected, без исключения', async () => {
      const { svc } = service({}, null, {
        ozon: async () => {
          throw new MarketplaceNotConnectedError('ozon', 'u1', 'no-credentials');
        },
      });
      const report = await svc.syncUser('u1', { marketplaces: ['ozon', 'wb'] });
      expect(report.results.ozon).toMatchObject({ outcome: 'not-connected' });
      // У площадки нет возможности в реестре — тоже «не подключено».
      expect(report.results.wb).toMatchObject({ outcome: 'not-connected' });
    });
  });
});
