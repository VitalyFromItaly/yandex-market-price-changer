import type { ITestFinanceDb } from '../helpers/test-postgres';
import type { TFinanceDb } from '../../src/database/postgres/finance-db';
import type { IOrderProfit } from '../../src/modules/accounting/order-profit-state';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AccountingOrderResultRepository } from '../../src/database/postgres/repositories/accounting-order-result.repository';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Первая запись снимка результата заказа при гонке (алерт 23505
 * `accounting_order_results_key_uq` из `crm-job:accounting:dashboard`): `FOR UPDATE`
 * не блокирует отсутствующую голову, два пересчёта одного заказа оба шли в INSERT.
 */

const SELLER = '406937947';
const KEY = { marketplace: 'ym' as const, orderId: '64478684739' };
const NOW = new Date('2026-11-16T10:42:30Z');

const profit = (over: Partial<IOrderProfit> = {}): IOrderProfit => ({
  state: 'preliminary',
  final: false,
  reconcile: null,
  amounts: [],
  confirmedKopecks: 0,
  expectedKopecks: 87_385,
  netKopecks: null,
  unknown: null,
  ...over,
});

/**
 * Имитация проигранной гонки на однопоточном PGlite: первый `SELECT … FOR UPDATE`
 * головы внутри транзакции отвечает «нет строки», хотя чужая транзакция её уже
 * закоммитила.
 */
function losingRaceDb(db: TFinanceDb): TFinanceDb {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'transaction') return Reflect.get(target, prop, receiver);
      return (cb: (tx: unknown) => Promise<unknown>) =>
        target.transaction((tx) => {
          let first = true;
          const staleTx = new Proxy(tx, {
            get(t, p, r) {
              if (p === 'select' && first) {
                first = false;
                return () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) });
              }
              return Reflect.get(t, p, r);
            },
          });
          return cb(staleTx);
        });
    },
  }) as TFinanceDb;
}

let pg: ITestFinanceDb;
let results: AccountingOrderResultRepository;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  results = new AccountingOrderResultRepository(pg.db);
});

beforeEach(async () => {
  await pg.reset();
});

afterAll(async () => {
  await pg.close();
});

describe('AccountingOrderResultRepository.recordSnapshot — гонка первой записи', () => {
  it('проиграл гонку с тем же отпечатком — не падает и ничего не пишет', async () => {
    await results.recordSnapshot(SELLER, KEY, profit(), NOW);
    const loser = new AccountingOrderResultRepository(losingRaceDb(pg.db));

    const write = await loser.recordSnapshot(SELLER, KEY, profit(), NOW);

    expect(write).toEqual({ version: 1, written: false, reason: null });
    expect(await results.versionsOf(SELLER, KEY)).toHaveLength(1);
  });

  it('проиграл гонку с другим отпечатком — пишет версию 2 поверх чужой головы', async () => {
    await results.recordSnapshot(SELLER, KEY, profit(), NOW);
    const loser = new AccountingOrderResultRepository(losingRaceDb(pg.db));

    const write = await loser.recordSnapshot(SELLER, KEY, profit({ expectedKopecks: 90_000 }), NOW);

    expect(write).toMatchObject({ version: 2, written: true, reason: 'recalculated' });
    expect((await results.currentOf(SELLER, KEY))?.expectedKopecks).toBe(90_000);
    expect((await results.versionsOf(SELLER, KEY)).map((v) => v.version)).toEqual([1, 2]);
  });

  it.skipIf(!process.env.TEST_POSTGRES_URL)(
    'параллельная первая запись с нескольких соединений — одна голова, одна версия (только живой Postgres)',
    async () => {
      const writes = await Promise.all(
        Array.from({ length: 8 }, () => results.recordSnapshot(SELLER, KEY, profit(), NOW)),
      );

      expect(writes.filter((w) => w.written)).toHaveLength(1);
      expect(await results.versionsOf(SELLER, KEY)).toHaveLength(1);
    },
  );
});
