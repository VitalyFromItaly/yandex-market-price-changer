import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  FinancePurchasesService,
  PurchaseNotFoundError,
} from '../../src/modules/finance/finance-purchases.service';
import { AccountingLotRepository } from '../../src/database/postgres/repositories/accounting-lot.repository';
import { productsStub, purchasesServiceOf } from '../helpers/purchases-service';
import { createTestFinanceDb } from '../helpers/test-postgres';

/** Закупки и уплаченные налоги (TASK-122) на PGlite. */

let test: ITestFinanceDb;
let service: FinancePurchasesService;

const SELLER = '111';
const purchase = (over: Record<string, unknown> = {}) => ({
  supplier: 'ООО Восток',
  paidDay: '2026-10-03',
  amount: '150 000',
  ...over,
});

beforeAll(async () => {
  test = await createTestFinanceDb();
  service = purchasesServiceOf(test.db);
}, 60_000);

afterAll(() => test?.close());
beforeEach(() => test.reset());

describe('FinancePurchasesService', () => {
  it('закупка: создать, поправить, удалить — копейки числом', async () => {
    const created = await service.createPurchase(SELLER, purchase());
    expect(created).toMatchObject({
      supplier: 'ООО Восток',
      amountKopecks: 15_000_000,
      lines: null,
    });
    expect(typeof created.amountKopecks).toBe('number');

    const updated = await service.updatePurchase(
      SELLER,
      created.id,
      purchase({
        amount: 3000,
        lines: [
          { sku: 'W1', name: 'Часы', count: 2, price: '1000' },
          { sku: 'W2', count: '1', price: 1000 },
        ],
      }),
    );
    expect(updated.lines).toEqual([
      { sku: 'W1', name: 'Часы', count: 2, priceKopecks: 100_000 },
      { sku: 'W2', name: null, count: 1, priceKopecks: 100_000 },
    ]);

    await service.removePurchase(SELLER, created.id);
    expect((await service.snapshot(SELLER)).purchases).toEqual([]);
  });

  it('Σ позиций ≠ сумме — ошибка под полем lines', async () => {
    await expect(
      service.createPurchase(
        SELLER,
        purchase({ amount: 100, lines: [{ sku: 'W1', count: 1, price: 50 }] }),
      ),
    ).rejects.toMatchObject({ field: 'lines' });
    await expect(service.createPurchase(SELLER, purchase({ supplier: ' ' }))).rejects.toMatchObject(
      {
        field: 'supplier',
      },
    );
    await expect(
      service.createPurchase(SELLER, purchase({ paidDay: '2026-02-30' })),
    ).rejects.toMatchObject({
      field: 'paidDay',
    });
  });

  it('чужая и не-uuid запись — «не найдено»', async () => {
    const other = await service.createPurchase('333', purchase());
    await expect(service.updatePurchase(SELLER, other.id, purchase())).rejects.toBeInstanceOf(
      PurchaseNotFoundError,
    );
    await expect(service.removePurchase(SELLER, other.id)).rejects.toBeInstanceOf(
      PurchaseNotFoundError,
    );
    await expect(service.removePurchase(SELLER, 'abc')).rejects.toBeInstanceOf(
      PurchaseNotFoundError,
    );
    expect((await service.snapshot('333')).purchases).toHaveLength(1);
  });

  it('уплата налога и выборка по дням оплаты', async () => {
    await service.createTaxPayment(SELLER, {
      paidDay: '2026-10-25',
      amount: 30_000,
      note: 'аванс Q3',
    });
    await service.createTaxPayment(SELLER, { paidDay: '2026-11-25', amount: 1 });
    await service.createPurchase(SELLER, purchase({ paidDay: '2026-09-30' }));
    const october = await service.between(SELLER, '2026-10-01', '2026-10-31');
    expect(october.purchases).toEqual([]);
    expect(october.taxPayments).toMatchObject([{ amountKopecks: 3_000_000, note: 'аванс Q3' }]);
  });
});

describe('партии «Финучёта» из закупки (TASK-214)', () => {
  let lots: AccountingLotRepository;
  let withProducts: FinancePurchasesService;

  beforeAll(() => {
    lots = new AccountingLotRepository(test.db);
    withProducts = purchasesServiceOf(test.db, productsStub({ W1: 'product-w1' }));
  });

  const lined = (over: Record<string, unknown> = {}) =>
    purchase({
      amount: 3000,
      lines: [
        { sku: 'W1', name: 'Часы', count: 2, price: 1000 },
        { sku: 'W2', count: 1, price: 1000 },
      ],
      delivery: '1 000,01',
      ...over,
    });

  it('закупка со строками → партии; несопоставленный артикул — без товара', async () => {
    const created = await withProducts.createPurchase(SELLER, lined());
    expect(created).toMatchObject({
      amountKopecks: 300_000,
      deliveryKopecks: 100_001,
      otherCostsKopecks: 0,
      lotCostSplit: 'value',
    });
    const rows = await lots.forPurchase(SELLER, created.id);
    expect(rows).toMatchObject([
      {
        lineIndex: 0,
        productId: 'product-w1',
        sku: 'W1',
        count: 2,
        remaining: 2,
        unitPriceKopecks: 100_000,
        extraKopecks: 66_667,
        receivedDay: '2026-10-03',
      },
      { lineIndex: 1, productId: null, sku: 'W2', count: 1, extraKopecks: 33_334 },
    ]);
    expect(rows.reduce((total, row) => total + row.extraKopecks, 0)).toBe(100_001);
  });

  it('закупка без строк партий не создаёт', async () => {
    const created = await withProducts.createPurchase(SELLER, purchase());
    expect(await lots.forPurchase(SELLER, created.id)).toEqual([]);
  });

  it('правка пересоздаёт партии; без полей партий доставка остаётся из базы', async () => {
    const created = await withProducts.createPurchase(SELLER, lined());
    const updated = await withProducts.updatePurchase(
      SELLER,
      created.id,
      purchase({ amount: 1000, lines: [{ sku: 'W2', count: 1, price: 1000 }] }),
    );
    expect(updated.deliveryKopecks).toBe(100_001);
    expect(await lots.forPurchase(SELLER, created.id)).toMatchObject([
      { lineIndex: 0, sku: 'W2', count: 1, remaining: 1, extraKopecks: 100_001 },
    ]);
  });

  it('правка убрала позиции, а доставка осталась — ошибка, всё откатывается', async () => {
    const created = await withProducts.createPurchase(SELLER, lined());
    await expect(
      withProducts.updatePurchase(SELLER, created.id, purchase({ amount: 999 })),
    ).rejects.toMatchObject({ field: 'lines' });
    const [stored] = (await withProducts.snapshot(SELLER)).purchases;
    expect(stored.amountKopecks).toBe(300_000);
    expect(await lots.forPurchase(SELLER, created.id)).toHaveLength(2);
  });

  it('удаление закупки снимает её партии', async () => {
    const created = await withProducts.createPurchase(SELLER, lined());
    await withProducts.removePurchase(SELLER, created.id);
    expect(await lots.listForUser(SELLER)).toEqual([]);
  });

  it('ДДС не меняется: доставка не входит в сумму закупки', async () => {
    await withProducts.createPurchase(SELLER, lined({ otherCosts: 500 }));
    const { purchases } = await withProducts.between(SELLER, '2026-10-01', '2026-10-31');
    expect(purchases.map((row) => row.amountKopecks)).toEqual([300_000]);
  });
});
