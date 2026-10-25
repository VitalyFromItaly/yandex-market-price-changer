import { describe, expect, it, vi } from 'vitest';

import { expandBreakdown } from '../../src/modules/finance/operation-breakdown';
import { ozonAccrualTypeArticle, ozonGoodsMovement } from '../../src/modules/finance/ozon-articles';
import {
  OZON_UNKNOWN_ARTICLE_CONTEXT,
  ozonAccrualKind,
  ozonAccrualParts,
  ozonAccrualToRow,
  ozonAccrualTypesMap,
  ozonAccrualsInPeriod,
  ozonFinanceOriginal,
  ozonOperationKey,
  ozonUnknownGroups,
  parseOzonDateTime,
  reportOzonUnknownArticles,
} from '../../src/modules/finance/ozon-journal';
import { pnlLineOf } from '../../src/modules/finance/pnl';

/**
 * Разбор начислений Ozon /v1/finance/accrual/by-day (TASK-194). Форма — по
 * спецификации Seller API; суммы продажи и возврата — из открытой фикстуры
 * pavelsur07/app-service-finance (accrual_by_day_cases.json). На живом ответе
 * наших продавцов не сверено (known-gaps).
 */

const CTX = {
  telegramUserId: '111',
  businessId: 'client-1',
  documentId: 'doc-1',
  documentVersion: 1,
  periodKey: 'ozon-transaction-list:2026-09-01:2026-09-30',
};

const TYPES = ozonAccrualTypesMap([
  { id: '1', name: 'Acquiring', description: 'Эквайринг' },
  { id: '16', name: 'Drop-Off', description: 'Обработка отправления' },
  { id: '28', name: 'LastMile', description: 'Последняя миля' },
  { id: '46', name: 'Placements', description: 'Размещение товаров' },
  { id: '72', name: 'SetOff', description: 'Взаимозачёт' },
]);

const rub = (amount: string) => ({ amount, currency: 'RUB' });

/**
 * Продажа: выручка 2999, комиссия −1379.54, доставка −118 и −5.35 → 1496.11.
 * `bonus` и `coinvestment` в сумму не входят.
 */
const sale = (over: Record<string, unknown> = {}) => ({
  accrual_id: 21600000001,
  date: '2026-09-16',
  unit_number: '0123-0001-1',
  accrued_category: 'POSTING',
  total_amount: rub('1496.11'),
  posting: {
    delivery_schema: 'Fbo',
    products: [
      {
        sku: 900001,
        commission: {
          sale_amount: rub('2999'),
          commission: rub('-1379.54'),
          sale_commission: rub('-1379.54'),
          bonus: rub('1818.74'),
          coinvestment: rub('11.69'),
          sale_price: rub('1168.57'),
          seller_price: rub('2999'),
        },
        delivery: {
          services: [
            { type_id: 28, accrued: rub('-118') },
            { type_id: 16, accrued: rub('-5.35') },
          ],
          total_accrued: rub('-123.35'),
        },
      },
    ],
  },
  ...over,
});

/** Возврат: выручка −2647, комиссия возвращена +1217.62 → −1429.38. */
const refund = () =>
  sale({
    accrual_id: 21600000002,
    total_amount: rub('-1429.38'),
    posting: {
      delivery_schema: 'Fbs',
      products: [
        {
          sku: 900001,
          commission: { sale_amount: rub('-2647'), commission: rub('1217.62') },
          delivery: { services: [], total_accrued: rub('0') },
        },
      ],
    },
  });

/** Сбор без отправления: хранение. */
const nonItem = (typeId: number, amount = '-120.50') => ({
  accrual_id: 5,
  date: '2026-09-20',
  unit_number: 'contract-77',
  accrued_category: 'NON_ITEM',
  total_amount: rub(amount),
  non_item_fee: { type_id: typeId, accrued: rub(amount) },
});

describe('классификатор статей Ozon', () => {
  it('статья — по имени типа, точное сравнение; незнакомое и спорное — unknown', () => {
    expect(ozonAccrualTypeArticle('Acquiring')).toBe('acquiring');
    expect(ozonAccrualTypeArticle(' LastMile ')).toBe('delivery_to_buyer');
    expect(ozonAccrualTypeArticle('ReturnFlowLogistic')).toBe('reverse_logistics');
    expect(ozonAccrualTypeArticle('Placements')).toBe('storage');
    expect(ozonAccrualTypeArticle('LastMileNew')).toBe('unknown');
    expect(ozonAccrualTypeArticle('SetOff')).toBe('unknown');
    expect(ozonAccrualTypeArticle(undefined)).toBe('unknown');
  });

  it('товар двигает только часть выручки продажи или возврата — старый и новый тип', () => {
    expect(ozonGoodsMovement('POSTING_SALE', 'sales')).toBe('sold');
    expect(ozonGoodsMovement('POSTING_SALE', 'commission')).toBeNull();
    expect(ozonGoodsMovement('POSTING_RETURN', 'returns')).toBe('returned');
    expect(ozonGoodsMovement('NON_ITEM', 'compensations')).toBeNull();
    // Строки, загруженные /v3/finance/transaction/list, хранят тип операции.
    expect(ozonGoodsMovement('OperationAgentDeliveredToCustomer', 'sales')).toBe('sold');
    expect(ozonGoodsMovement('ClientReturnAgentOperation', 'returns')).toBe('returned');
  });

  it('тип строки: у отправления — по знаку выручки, у остальных — категория', () => {
    expect(ozonAccrualKind(sale())).toBe('POSTING_SALE');
    expect(ozonAccrualKind(refund())).toBe('POSTING_RETURN');
    expect(ozonAccrualKind(sale({ posting: { products: [] } }))).toBe('POSTING');
    expect(ozonAccrualKind(nonItem(46))).toBe('NON_ITEM');
    expect(ozonAccrualKind({})).toBe('UNSPECIFIED');
  });
});

describe('дата начисления', () => {
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

describe('начисление → строка журнала', () => {
  it('продажа: сумма total_amount, части по статьям, заказ, схема, артикул через ключ закупа', () => {
    const op = ozonAccrualToRow(sale(), CTX, TYPES, (sku) => (sku === '900001' ? 'A1' : undefined));

    expect(op).toMatchObject({
      marketplace: 'ozon',
      operationKey: ozonOperationKey('21600000001', 149611),
      article: 'sales',
      direction: 'income',
      amountKopecks: 149611,
      orderId: '0123-0001-1',
      sku: 'A1',
      model: 'FBO',
      transactionType: 'POSTING_SALE',
      transactionSource: 'POSTING',
      serviceName: 'Продажа',
      accruedAt: new Date('2026-09-15T21:00:00Z'),
      periodKey: CTX.periodKey,
    });
    expect(op.breakdown).toEqual([
      { article: 'sales', kopecks: 299900, sheet: 'sale_amount' },
      { article: 'commission', kopecks: -137954, sheet: 'commission' },
      { article: 'delivery_to_buyer', kopecks: -11800, sheet: 'LastMile' },
      { article: 'processing', kopecks: -535, sheet: 'Drop-Off' },
    ]);
    // Σ частей = сумме начисления: bonus/coinvestment не попали, остатка нет.
    expect(op.breakdown?.reduce((sum, p) => sum + p.kopecks, 0)).toBe(op.amountKopecks);
    expect(op.raw).toEqual(sale());
  });

  it('возврат: выручка в returns, возвращённая комиссия — плюсом', () => {
    const op = ozonAccrualToRow(refund(), CTX, TYPES);
    expect(op).toMatchObject({
      article: 'returns',
      direction: 'expense',
      amountKopecks: -142938,
      transactionType: 'POSTING_RETURN',
      serviceName: 'Возврат',
      model: 'FBS',
    });
    expect(op.breakdown).toEqual([
      { article: 'returns', kopecks: -264700, sheet: 'sale_amount' },
      { article: 'commission', kopecks: 121762, sheet: 'commission' },
    ]);
  });

  it('ключ совпадает со старым для того же id и суммы — повторный импорт без дублей', () => {
    // Старый разбор считал ключ так же: ozonOperationKey(operation_id, amount).
    expect(ozonAccrualToRow(sale(), CTX, TYPES).operationKey).toBe(
      ozonOperationKey('21600000001', 149611),
    );
    expect(ozonAccrualToRow(sale(), CTX, TYPES).operationKey).toBe(
      ozonAccrualToRow(sale(), { ...CTX, documentId: 'doc-2', documentVersion: 2 }, TYPES)
        .operationKey,
    );
    expect(ozonAccrualToRow(sale(), CTX, TYPES).operationKey).not.toBe(
      ozonAccrualToRow(sale({ total_amount: rub('1496.10') }), CTX, TYPES).operationKey,
    );
  });

  it('SKU не нашёлся в каталоге — остаётся SKU Ozon; два артикула — пусто', () => {
    expect(ozonAccrualToRow(sale(), CTX, TYPES).sku).toBe('900001');
    const item = {
      accrual_id: 9,
      date: '2026-09-16',
      unit_number: '0123-0001-1',
      accrued_category: 'ITEM',
      total_amount: rub('-30'),
      item_fees: {
        fees: [
          { sku: 1, fees: [{ type_id: 1, accrued: rub('-10') }] },
          { sku: 2, fees: [{ type_id: 1, accrued: rub('-20') }] },
        ],
      },
    };
    const row = ozonAccrualToRow(item, CTX, TYPES);
    expect(row.sku).toBeUndefined();
    expect(row).toMatchObject({
      article: 'acquiring',
      orderId: '0123-0001-1',
      transactionType: 'ITEM',
      serviceName: 'Эквайринг',
    });
    expect(row.breakdown).toBeUndefined();
  });

  it('сбор продавца: статья по типу, без расшифровки, договор — не заказ', () => {
    const storage = ozonAccrualToRow(nonItem(46), CTX, TYPES);
    expect(storage).toMatchObject({
      article: 'storage',
      amountKopecks: -12050,
      direction: 'expense',
      transactionType: 'NON_ITEM',
      serviceName: 'Размещение товаров',
    });
    expect(storage.breakdown).toBeUndefined();
    expect(storage.orderId).toBeUndefined();
  });

  it('незнакомый тип, тип вне справочника и несошедшийся остаток — unknown с подписью', () => {
    const setOff = ozonAccrualToRow(nonItem(72), CTX, TYPES);
    const outside = ozonAccrualToRow(nonItem(999, '-5'), CTX, TYPES);
    const remainder = ozonAccrualToRow(sale({ total_amount: rub('1500') }), CTX, TYPES);

    expect([setOff.article, outside.article, remainder.article]).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(remainder.breakdown).toContainEqual({ article: 'unknown', kopecks: 389, sheet: null });
    expect(ozonUnknownGroups([setOff, outside, remainder]).map((g) => g.signature)).toEqual([
      'тип начисления SetOff',
      'тип начисления type_id 999',
      'остаток без составляющей у POSTING_SALE',
    ]);
  });

  it('без id, суммы или даты — бросает, а не пишет «начисление на ноль»', () => {
    expect(() => ozonAccrualToRow(sale({ accrual_id: null }), CTX, TYPES)).toThrow(/accrual_id/);
    expect(() => ozonAccrualToRow(sale({ total_amount: rub('abc') }), CTX, TYPES)).toThrow(
      /без суммы/,
    );
    expect(() => ozonAccrualToRow(sale({ date: '' }), CTX, TYPES)).toThrow(/без даты/);
  });

  it('части сходятся с суммой, остаток не теряется', () => {
    const parts = ozonAccrualParts(sale(), 150000, TYPES);
    expect(parts.reduce((sum, p) => sum + p.kopecks, 0)).toBe(150000);
  });
});

describe('P&L: части одного начисления двигают товар один раз', () => {
  it('после expandBreakdown товар — только у строки выручки', () => {
    const op = ozonAccrualToRow(sale(), CTX, TYPES);
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
    expect(lines.reduce((sum, l) => sum + l.amountKopecks, 0)).toBe(149611);
  });
});

describe('период и оригинал версии', () => {
  const period = { from: '2026-09-01', to: '2026-09-30' };

  it('начисления вне дней периода — в dropped', () => {
    const { accruals, dropped } = ozonAccrualsInPeriod(
      [
        sale(),
        sale({ accrual_id: 2, date: '2026-10-01' }),
        sale({ accrual_id: 3, date: '2026-09-30' }),
        sale({ accrual_id: 4, date: '' }),
      ],
      period,
    );
    expect(accruals.map((a) => a.accrual_id)).toEqual([21600000001, 3]);
    expect(dropped).toBe(2);
  });

  it('одинаковый ответ в другом порядке — те же байты (sha256 → unchanged)', () => {
    const a = sale();
    const b = sale({ accrual_id: 7 });
    const reordered = Object.fromEntries(Object.entries(b).reverse());
    expect(
      ozonFinanceOriginal(period, [a, b], TYPES).equals(
        ozonFinanceOriginal(period, [reordered, a], TYPES),
      ),
    ).toBe(true);
  });

  it('новое имя встретившегося типа меняет байты; тип, которого в периоде нет, — нет', () => {
    const base = ozonFinanceOriginal(period, [sale()], TYPES);
    const renamed = ozonAccrualTypesMap([
      ...TYPES.values(),
      { id: '28', name: 'LastMileV2', description: '' },
    ]);
    const extra = ozonAccrualTypesMap([
      ...TYPES.values(),
      { id: '500', name: 'Brand', description: '' },
    ]);
    expect(ozonFinanceOriginal(period, [sale()], renamed).equals(base)).toBe(false);
    expect(ozonFinanceOriginal(period, [sale()], extra).equals(base)).toBe(true);
  });
});

describe('алерт о нераспознанном', () => {
  it('один отчёт на загрузку, место без id; нет нераспознанного — без алерта', async () => {
    const report = vi.fn(async () => undefined);
    const unknown = ozonAccrualToRow(nonItem(72), CTX, TYPES);
    expect(await reportOzonUnknownArticles({ report }, [unknown, unknown], '111')).toBe(2);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: OZON_UNKNOWN_ARTICLE_CONTEXT, telegramUserId: '111' }),
    );

    report.mockClear();
    expect(
      await reportOzonUnknownArticles({ report }, [ozonAccrualToRow(sale(), CTX, TYPES)], '111'),
    ).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });
});
