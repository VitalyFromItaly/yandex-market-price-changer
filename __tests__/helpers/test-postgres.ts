/**
 * Тестовая база финансов: PGlite в процессе или живой Postgres из
 * TEST_POSTGRES_URL (решение `finance_postgres_tests`).
 *
 * PGlite — настоящий Postgres, собранный в WASM: `npm test` идёт на любой
 * машине без Docker, а миграции — те же файлы drizzle/, что в проде. В CI те же
 * тесты прогоняются ещё раз на настоящем сервере (TEST_POSTGRES_URL): PGlite —
 * один процесс, и гонки двух соединений на нём не воспроизвести.
 *
 * Живой сервер: на каждый вызов — своя база `fin_test_<случайное>`, удаляется в
 * close(). Схема в той же базе не годится: внешние ключи в миграции
 * квалифицированы `"public"`, а файлы тестов vitest гоняет параллельно.
 */

import type { TFinanceDb } from '../../src/database/postgres/finance-db';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

import { MIGRATIONS_FOLDER, MIGRATIONS_TABLE } from '../../src/database/postgres/finance-db';
import { financeSchema } from '../../src/database/postgres/finance.schema';

export interface ITestFinanceDb {
  db: TFinanceDb;
  /** true — настоящий Postgres из TEST_POSTGRES_URL, false — PGlite. */
  live: boolean;
  /** Пул живой базы — для тестов гонок двумя соединениями. */
  pool?: Pool;
  /** Очистить таблицы между тестами. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

const TABLES = [
  'finance_anomalies',
  'finance_anomaly_reviews',
  'finance_discrepancies',
  'finance_act_services',
  'finance_periods',
  'finance_corrections',
  'finance_operations',
  'finance_documents',
  'finance_expenses',
  'finance_expense_categories',
  'finance_tax_settings',
  'finance_purchases',
  'finance_tax_years',
  'finance_tax_reductions',
  'finance_tax_reconciliations',
  'finance_tax_payments',
];

export const LIVE_POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;

export async function createTestFinanceDb(): Promise<ITestFinanceDb> {
  return LIVE_POSTGRES_URL ? createLive(LIVE_POSTGRES_URL) : createPglite();
}

async function createPglite(): Promise<ITestFinanceDb> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema: financeSchema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER, ...MIGRATIONS_TABLE });
  return {
    db: db as unknown as TFinanceDb,
    live: false,
    reset: async () => {
      await client.exec(`TRUNCATE ${TABLES.join(', ')}`);
    },
    close: () => client.close(),
  };
}

async function createLive(url: string): Promise<ITestFinanceDb> {
  const name = `fin_test_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);

  const target = new URL(url);
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.toString(), max: 5 });
  const db = drizzlePg(pool, { schema: financeSchema });
  await migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER, ...MIGRATIONS_TABLE });

  return {
    db: db as unknown as TFinanceDb,
    live: true,
    pool,
    reset: async () => {
      await pool.query(`TRUNCATE ${TABLES.join(', ')}`);
    },
    close: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    },
  };
}
