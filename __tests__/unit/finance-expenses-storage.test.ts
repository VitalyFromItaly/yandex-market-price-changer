import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
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
});
