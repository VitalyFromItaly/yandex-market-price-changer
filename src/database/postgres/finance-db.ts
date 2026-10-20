import type { financeSchema } from './finance.schema';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';

import { join } from 'node:path';

/**
 * База финансов — общий тип для рантайма (`drizzle-orm/node-postgres`) и тестов
 * (`drizzle-orm/pglite`): оба наследуют PgDatabase, и репозитории не должны
 * знать, какой драйвер под ними.
 */
export type TFinanceDb = PgDatabase<PgQueryResultHKT, typeof financeSchema>;

export type TFinanceTx = PgTransaction<
  PgQueryResultHKT,
  typeof financeSchema,
  ExtractTablesWithRelations<typeof financeSchema>
>;

/**
 * То, на чём выполнять запрос: сама база или открытая транзакция. Каждый метод
 * репозитория принимает его последним аргументом — так импорт складывает
 * несколько методов в одну транзакцию, не заводя второй набор методов.
 */
export type TFinanceExecutor = TFinanceDb | TFinanceTx;

/** DI-токен базы финансов. */
export const FINANCE_DB = Symbol('FINANCE_DB');

/**
 * Каталог миграций drizzle-kit. От __dirname, а не от cwd: в проде это
 * /app/dist/database/postgres → /app/drizzle, под ts-node — src/… → корень репо.
 */
export const MIGRATIONS_FOLDER = join(__dirname, '..', '..', '..', 'drizzle');

/** Таблица учёта миграций — та же, что в drizzle.config.ts. */
export const MIGRATIONS_TABLE = {
  migrationsSchema: 'public',
  migrationsTable: '__drizzle_migrations',
};
