import type { ITestFinanceDb } from '../helpers/test-postgres';
import type { IAccountingOrderLineInput } from '../../src/modules/accounting/accounting-order-lines.domain';
import type { IOrderResultOperation } from '../../src/modules/accounting/order-result';
import type {
  IAllocationOrder,
  IStoreCostItem,
} from '../../src/modules/accounting/store-cost-allocation';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AccountingAllocationSettingsRepository } from '../../src/database/postgres/repositories/accounting-allocation-settings.repository';
import { AccountingAllocationSettingsService } from '../../src/modules/accounting/accounting-allocation-settings.service';
import { orderResultOf } from '../../src/modules/accounting/order-result';
import {
  allocateStoreCosts,
  DEFAULT_ALLOCATION_METHOD,
  isAllocationMethod,
  storeCostKindOf,
} from '../../src/modules/accounting/store-cost-allocation';
import { FINANCE_ARTICLE_KEYS } from '../../src/modules/finance/finance-articles';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Распределение общих расходов «Финучёта» (TASK-219): сумма до копейки,
 * методика «не распределять», нераспределённое не теряется, распределённое —
 * только `allocated` с названием методики.
 */

const ORDERS: IAllocationOrder[] = [
  { orderId: 'A', revenueKopecks: 10_000, units: 1 },
  { orderId: 'B', revenueKopecks: 20_000, units: 1 },
  { orderId: 'C', revenueKopecks: 40_000, units: 2 },
];

const AD_1000: IStoreCostItem = {
  id: 'ad',
  kind: 'advertising',
  kopecks: -100_000,
  title: 'Буст продаж',
  article: 'promotion',
  source: 'journal',
};

const sumAllocated = (
  byOrder: ReturnType<typeof allocateStoreCosts>['byOrder'],
  kind: 'advertising' | 'opex' | 'tax',
) => [...byOrder.values()].reduce((acc, a) => acc + (a[kind]?.kopecks ?? 0), 0);

describe('allocateStoreCosts', () => {
  it('1 000,00 ₽ рекламы на 3 заказа по выручке — сумма сходится до копейки', () => {
    const result = allocateStoreCosts({
      method: 'revenue_share',
      orders: ORDERS,
      items: [AD_1000],
    });
    // 1/7, 2/7, 4/7 от 100 000: остаток 2 коп. — наибольшим дробным частям (C, затем A).
    expect(result.byOrder.get('A')?.advertising).toEqual({
      kopecks: -14_286,
      method: 'Пропорционально выручке',
    });
    expect(result.byOrder.get('B')?.advertising?.kopecks).toBe(-28_571);
    expect(result.byOrder.get('C')?.advertising?.kopecks).toBe(-57_143);
    expect(sumAllocated(result.byOrder, 'advertising')).toBe(-100_000);
    expect(result.allocatedKopecks.advertising).toBe(-100_000);
    expect(result.unallocated.items).toEqual([]);
    expect(result.totalKopecks).toBe(-100_000);
  });

  it('по штукам — веса — штуки заказа', () => {
    const result = allocateStoreCosts({ method: 'units_share', orders: ORDERS, items: [AD_1000] });
    expect(result.byOrder.get('A')?.advertising).toEqual({
      kopecks: -25_000,
      method: 'Пропорционально штукам',
    });
    expect(result.byOrder.get('C')?.advertising?.kopecks).toBe(-50_000);
  });

  it('методика none — заказы без рекламы, всё в нераспределённом, итог периода тот же', () => {
    const shared = allocateStoreCosts({
      method: 'revenue_share',
      orders: ORDERS,
      items: [AD_1000],
    });
    const none = allocateStoreCosts({ method: 'none', orders: ORDERS, items: [AD_1000] });
    expect(none.byOrder.size).toBe(0);
    expect(none.unallocated.items).toEqual([{ ...AD_1000, reason: 'method-none' }]);
    expect(none.unallocated.totalKopecks).toBe(-100_000);
    expect(none.totalKopecks).toBe(shared.totalKopecks);
  });

  it('период без выручки — в нераспределённое (no-base), без исключения', () => {
    const orders = [
      { orderId: 'X', revenueKopecks: 0, units: null },
      { orderId: 'Y', revenueKopecks: -500, units: 1 },
    ];
    const result = allocateStoreCosts({ method: 'revenue_share', orders, items: [AD_1000] });
    expect(result.byOrder.size).toBe(0);
    expect(result.unallocated.items[0].reason).toBe('no-base');
    expect(
      allocateStoreCosts({ method: 'units_share', orders: [], items: [AD_1000] }).unallocated
        .totalKopecks,
    ).toBe(-100_000);
  });

  it('виды делятся каждый по-своему, доход без заказа — not-a-cost', () => {
    const items: IStoreCostItem[] = [
      AD_1000,
      { id: 'st', kind: 'opex', kopecks: -7_001, title: 'Хранение', article: 'storage' },
      { id: 'tax', kind: 'tax', kopecks: -4_200, title: 'Налог периода', source: 'tax' },
      { id: 'inc', kind: null, kopecks: 3_000, title: 'Компенсация', article: 'compensations' },
    ];
    const result = allocateStoreCosts({ method: 'revenue_share', orders: ORDERS, items });
    expect(sumAllocated(result.byOrder, 'opex')).toBe(-7_001);
    expect(sumAllocated(result.byOrder, 'tax')).toBe(-4_200);
    expect(result.unallocated.items).toEqual([{ ...items[3], reason: 'not-a-cost' }]);
    const allocated =
      result.allocatedKopecks.advertising +
      result.allocatedKopecks.opex +
      result.allocatedKopecks.tax;
    expect(allocated + result.unallocated.totalKopecks).toBe(result.totalKopecks);
  });

  it('знак сохраняется, равные веса — детерминированно, заказ с нулевой долей без записи', () => {
    const refund: IStoreCostItem = { ...AD_1000, id: 'refund', kopecks: 2 };
    const orders = [
      { orderId: 'A', revenueKopecks: 1, units: 1 },
      { orderId: 'B', revenueKopecks: 1, units: 1 },
      { orderId: 'C', revenueKopecks: 1, units: 1 },
    ];
    const result = allocateStoreCosts({ method: 'revenue_share', orders, items: [refund] });
    expect(result.byOrder.get('A')?.advertising?.kopecks).toBe(1);
    expect(result.byOrder.get('B')?.advertising?.kopecks).toBe(1);
    expect(result.byOrder.has('C')).toBe(false);
  });
});

describe('storeCostKindOf и методика', () => {
  it('продвижение — реклама, расходы — opex, доходы и справочное — не расход', () => {
    expect(storeCostKindOf('promotion')).toBe('advertising');
    expect(storeCostKindOf('storage')).toBe('opex');
    expect(storeCostKindOf('unknown')).toBe('opex');
    expect(storeCostKindOf('sales')).toBeNull();
    expect(storeCostKindOf('bonus_payment')).toBeNull();
    for (const article of FINANCE_ARTICLE_KEYS)
      expect(() => storeCostKindOf(article)).not.toThrow();
  });

  it('умолчание — по выручке; чужие значения не методика', () => {
    expect(DEFAULT_ALLOCATION_METHOD).toBe('revenue_share');
    expect(isAllocationMethod('units_share')).toBe(true);
    expect(isAllocationMethod('toString')).toBe(false);
    expect(isAllocationMethod(null)).toBe(false);
  });
});

describe('распределённое в карточке заказа', () => {
  const day = new Date('2026-10-05T09:00:00Z');
  const op = (partial: Partial<IOrderResultOperation>): IOrderResultOperation => ({
    id: 'op',
    article: 'sales',
    amountKopecks: 0,
    orderId: 'A',
    sku: null,
    serviceName: null,
    transactionType: 'Начисление',
    transactionSource: null,
    accruedAt: day,
    paidAt: null,
    actDate: null,
    model: 'FBS',
    count: null,
    marketplace: 'ym',
    origin: 'journal',
    ...partial,
  });
  const line: IAccountingOrderLineInput = {
    marketplace: 'ym',
    orderId: 'A',
    itemId: '1',
    campaignId: null,
    offerId: 'A1',
    offerName: 'Товар',
    count: 1,
    priceKopecks: 10_000,
    buyerPriceKopecks: 10_000,
    buyerPriceBeforeDiscountKopecks: null,
    marketplaceSubsidyKopecks: 0,
    sellerDiscountKopecks: null,
    revenueKopecks: 10_000,
    payoutKopecks: null,
    commissionKopecks: null,
    status: 'DELIVERED',
    substatus: null,
    createdOn: '2026-10-05',
    soldOn: '2026-10-07',
    deliveryOn: null,
    returnedOn: null,
    source: 'ym-orders',
  };

  it('распределённая реклама и общие расходы — allocated с методикой, фактическая реклама заказа не меняется', () => {
    const { byOrder } = allocateStoreCosts({
      method: 'revenue_share',
      orders: ORDERS,
      items: [
        AD_1000,
        { id: 'st', kind: 'opex', kopecks: -700, title: 'Хранение', article: 'storage' },
      ],
    });
    const input = {
      marketplace: 'ym' as const,
      orderId: 'A',
      lines: [line],
      operations: [
        op({ id: 's', article: 'sales', amountKopecks: 10_000 }),
        op({ id: 'own-ad', article: 'promotion', amountKopecks: -500 }),
      ],
      costOf: () => ({ status: 'unknown' as const, reason: 'no-product' as const }),
    };
    const result = orderResultOf({ ...input, allocations: byOrder.get('A') });
    const find = (key: string) => result.amounts.find((a) => a.key === key);
    expect(find('advertising')).toMatchObject({
      kopecks: -500,
      source: 'actual',
      operationIds: ['own-ad'],
    });
    expect(find('advertising_allocated')).toMatchObject({
      kopecks: -14_286,
      source: 'allocated',
      method: 'Пропорционально выручке',
    });
    expect(find('opex_allocated')).toMatchObject({ kopecks: -100, source: 'allocated' });
    expect(orderResultOf(input).amounts.find((a) => a.key === 'opex_allocated')).toBeUndefined();
  });
});

describe('AccountingAllocationSettingsService (PGlite)', () => {
  let fin: ITestFinanceDb;
  let service: AccountingAllocationSettingsService;
  let repository: AccountingAllocationSettingsRepository;

  beforeAll(async () => {
    fin = await createTestFinanceDb();
    repository = new AccountingAllocationSettingsRepository(fin.db);
    service = new AccountingAllocationSettingsService(repository);
  });
  afterAll(async () => fin.close());

  it('нет строки — умолчание по выручке; выбор продавца — одна строка', async () => {
    expect(await repository.find('u1')).toBeNull();
    expect(await service.snapshot('u1')).toMatchObject({
      method: 'revenue_share',
      isDefault: true,
    });
    await service.set('u1', 'none');
    await service.set('u1', 'units_share');
    expect(await service.snapshot('u1')).toMatchObject({
      method: 'units_share',
      methodTitle: 'Пропорционально штукам',
      isDefault: false,
    });
    expect(await service.methodOf('u2')).toBe('revenue_share');
  });

  it('не методика — 400, строка не пишется', async () => {
    await expect(service.set('u3', 'everything')).rejects.toThrow('методику');
    expect(await repository.find('u3')).toBeNull();
  });
});
