import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit: генерация миграций из `src/database/postgres/finance.schema.ts`
 * (`npm run db:pg:generate`) и их применение (`npm run db:pg:migrate`).
 * Приложение применяет те же миграции само при старте — см. PostgresModule.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/postgres/finance.schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.POSTGRES_URL ?? '' },
  migrations: { schema: 'public', table: '__drizzle_migrations' },
});
