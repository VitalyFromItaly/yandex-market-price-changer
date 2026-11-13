import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { randomUUID } from 'node:crypto';

import { AccountingManualOperationRepository } from '../../src/database/postgres/repositories/accounting-manual-operation.repository';
import { financeOperations } from '../../src/database/postgres/finance.schema';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { AccountingManualOperationsService } from '../../src/modules/accounting/accounting-manual-operations.service';
import {
  ExpenseCategoryInUseError,
  ExpenseNotFoundError,
  ExpenseValidationError,
  FinanceExpensesService,
} from '../../src/modules/finance/finance-expenses.service';
import { createTestFinanceDb } from '../helpers/test-postgres';

const SELLER = '222';
const OTHER = '333';
const rent = { kind: 'monthly', category: 'rent', amount: 30000, fromDay: '2026-10-01' };

describe('Расходы бизнеса в Postgres', () => {
  let test: ITestFinanceDb;
  let service: FinanceExpensesService;

  beforeAll(async () => {
    test = await createTestFinanceDb();
    service = new FinanceExpensesService(new FinanceExpenseRepository(test.db));
  }, 60_000);

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    await test.reset();
  });

  it('создание, правка и удаление; копейки bigint возвращаются числом', async () => {
    const created = await service.create(SELLER, rent);
    expect(created).toMatchObject({ amountKopecks: 3_000_000, toDay: null, kind: 'monthly' });
    expect(typeof created.amountKopecks).toBe('number');

    const updated = await service.update(SELLER, created.id, { ...rent, amount: '45 000,50' });
    expect(updated.amountKopecks).toBe(4_500_050);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    await service.remove(SELLER, created.id);
    expect((await service.snapshot(SELLER)).expenses).toEqual([]);
  });

  it('чужая запись не существует: ни правки, ни удаления', async () => {
    const created = await service.create(SELLER, rent);
    await expect(service.update(OTHER, created.id, rent)).rejects.toBeInstanceOf(
      ExpenseNotFoundError,
    );
    await expect(service.remove(OTHER, created.id)).rejects.toBeInstanceOf(ExpenseNotFoundError);
    await expect(service.remove(SELLER, 'not-a-uuid')).rejects.toBeInstanceOf(ExpenseNotFoundError);
    expect((await service.snapshot(SELLER)).expenses).toHaveLength(1);
    expect((await service.snapshot(OTHER)).expenses).toEqual([]);
  });

  it('ввод проверяется до записи', async () => {
    await expect(service.create(SELLER, { ...rent, amount: -1 })).rejects.toMatchObject({
      field: 'amount',
    });
    expect((await service.snapshot(SELLER)).expenses).toEqual([]);
  });

  it('своя категория: заводится, используется, занятая не удаляется', async () => {
    const category = await service.addCategory(SELLER, 'Реклама у блогеров');
    await expect(service.addCategory(SELLER, 'реклама у блогеров')).rejects.toBeInstanceOf(
      ExpenseValidationError,
    );
    // Чужая своя категория для другого продавца неизвестна.
    await expect(service.create(OTHER, { ...rent, category: category.id })).rejects.toMatchObject({
      field: 'category',
    });

    const expense = await service.create(SELLER, { ...rent, category: category.id });
    await expect(service.removeCategory(SELLER, category.id)).rejects.toBeInstanceOf(
      ExpenseCategoryInUseError,
    );

    await service.remove(SELLER, expense.id);
    await service.removeCategory(SELLER, category.id);
    expect((await service.snapshot(SELLER)).categories).toEqual([]);
  });

  it('allocatedFor читает базу заново — правка расхода сразу видна в распределении', async () => {
    const created = await service.create(SELLER, rent);
    const week = { from: '2026-10-05', to: '2026-10-11' };
    expect((await service.allocatedFor(SELLER, week)).totalKopecks).toBe(677_419);

    await service.update(SELLER, created.id, { ...rent, amount: 62000 });
    expect((await service.allocatedFor(SELLER, week)).totalKopecks).toBe(1_400_000);
    expect((await service.allocatedFor(OTHER, week)).totalKopecks).toBe(0);
    await expect(service.allocatedFor(SELLER, { from: 'x', to: 'y' })).rejects.toMatchObject({
      field: 'period',
    });
  });

  it('v2: старый ввод — привязки нет; поля привязки и источник сохраняются', async () => {
    const old = await service.create(SELLER, rent);
    expect(old).toMatchObject({
      source: null,
      scope: null,
      marketplace: null,
      orderId: null,
      sku: null,
      doubleCountArticle: null,
    });
    const bound = await service.create(SELLER, {
      kind: 'one_off',
      category: 'packaging',
      amount: 500,
      fromDay: '2026-10-05',
      scope: 'order',
      marketplace: 'ym',
      orderId: '555',
      source: 'Чек 12',
    });
    expect(bound).toMatchObject({ scope: 'order', marketplace: 'ym', orderId: '555', source: 'Чек 12' });
    // Расход заказа — целиком в любом месяце; аренда — доля месяца.
    const october = await service.forAccounting(SELLER, { from: '2026-10-01', to: '2026-10-31' });
    expect(october.map((e) => [e.row.id, e.kopecks])).toEqual([
      [old.id, 3_000_000],
      [bound.id, 50_000],
    ]);
  });

  it('v2: подписка, уже начисленная в реестре за тот же месяц, — флаг на расходе', async () => {
    const manual = new AccountingManualOperationsService(
      new AccountingManualOperationRepository(test.db),
    );
    await manual.create(
      SELLER,
      {
        clientKey: randomUUID(),
        marketplace: 'ozon',
        article: 'subscription',
        amount: '-1990',
        accruedOn: '2026-10-31',
        source: 'Акт',
      },
      { author: SELLER, impersonatedBy: null },
    );
    const sub = {
      kind: 'one_off',
      category: 'marketplace_subscriptions',
      amount: 1990,
      fromDay: '2026-10-03',
    };
    expect((await service.create(SELLER, sub)).doubleCountArticle).toBe('subscription');
    expect((await service.create(OTHER, sub)).doubleCountArticle).toBeNull();
    const ym = await service.create(SELLER, { ...sub, scope: 'marketplace', marketplace: 'ym' });
    expect(ym.doubleCountArticle).toBeNull();
    // Правка в другой месяц снимает флаг.
    const moved = await service.update(SELLER, ym.id, { ...sub, fromDay: '2026-09-03' });
    expect(moved.doubleCountArticle).toBeNull();
  });

  it('v2: реклама в расшифровке сводной строки журнала — тоже совпадение', async () => {
    const { document } = await new FinanceDocumentRepository(test.db).registerVersion({
      marketplace: 'ym',
      telegramUserId: SELLER,
      businessId: 'b1',
      reportType: 'united-netting',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      buffer: Buffer.from('[]'),
      filename: 'netting.zip',
      contentType: 'application/zip',
    });
    await test.db.insert(financeOperations).values({
      marketplace: 'ym',
      telegramUserId: SELLER,
      businessId: 'b1',
      operationKey: 'k1',
      article: 'other_services',
      direction: 'out',
      amountKopecks: -50_000,
      transactionType: 'Удержание',
      accruedAt: new Date('2026-10-20T10:00:00+03:00'),
      documentId: document.id,
      documentVersion: document.version,
      periodKey: 'p',
      lastDocumentId: document.id,
      lastDocumentVersion: document.version,
      raw: {},
      breakdown: [
        { article: 'promotion', kopecks: -30_000, sheet: 'Буст' },
        { article: 'storage', kopecks: -20_000, sheet: null },
      ],
    } as never);
    const ads = { kind: 'one_off', category: 'advertising', amount: 300, fromDay: '2026-10-02' };
    expect((await service.create(SELLER, ads)).doubleCountArticle).toBe('promotion');
    expect(
      (await service.create(SELLER, { ...ads, scope: 'marketplace', marketplace: 'wb' }))
        .doubleCountArticle,
    ).toBeNull();
  });
});
