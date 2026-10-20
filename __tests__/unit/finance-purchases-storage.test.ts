import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import {
  FinancePurchasesService,
  PurchaseNotFoundError,
} from '../../src/modules/finance/finance-purchases.service';
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
  service = new FinancePurchasesService(new FinancePurchaseRepository(test.db));
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
