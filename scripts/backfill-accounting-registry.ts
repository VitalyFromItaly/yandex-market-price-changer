import 'dotenv/config';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { FINANCE_DB, type TFinanceDb } from '../src/database/postgres/finance-db';
import {
  FINANCE_MARKETPLACES,
  type TFinanceMarketplace,
} from '../src/database/postgres/finance.schema';
import { PostgresModule } from '../src/database/postgres/postgres.module';
import { backfillAccountingRegistry } from '../src/modules/accounting/accounting-registry-backfill';
import { ACCOUNTING_SUB_ARTICLE_TITLE } from '../src/modules/accounting/accounting-sub-articles';
import { ErrorsModule } from '../src/modules/errors/errors.module';

/**
 * Бэкфилл колонок реестра «Финучёта» (TASK-207): `sub_article`, `currency`,
 * `item_id`, `reported_at`, `processing_status` у строк `finance_operations`,
 * записанных до миграции 0012. Значения — из сохранённого `raw` той же функцией,
 * что зовёт импорт (`accountingColumnsOf`).
 *
 * Пишет ТОЛЬКО наш Postgres и только эти пять колонок; площадки не трогает.
 * Без `--apply` — dry run: печатает, сколько строк изменилось бы, и
 * распределение подстатей. Повторный `--apply` ничего не меняет (обновляются
 * только строки, где вычисленное отличается). Текущий P&L колонки не читает —
 * сверка: `scripts/pnl-finance.ts` до и после совпадает до копейки.
 *
 * Колонки должны уже быть: приложение мигрирует себя на старте, иначе —
 * `npm run db:pg:migrate`. Nest поднимается без AppModule (довод diagnose-*).
 *
 * Запуск:
 *   npx ts-node scripts/backfill-accounting-registry.ts [--user=<telegramUserId>] [--marketplace=ym|ozon|wb] [--apply]
 */

@Module({ imports: [AppConfigModule, ErrorsModule, PostgresModule] })
class BackfillRegistryModule {}

function isFinanceMarketplace(value: string): value is TFinanceMarketplace {
  return (FINANCE_MARKETPLACES as readonly string[]).includes(value);
}

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const marketplace = get('marketplace');
  if (marketplace !== undefined && !isFinanceMarketplace(marketplace)) {
    throw new Error(`--marketplace: ${FINANCE_MARKETPLACES.join(' | ')}`);
  }
  return { user: get('user'), marketplace, apply: argv.includes('--apply') };
}

async function main(): Promise<void> {
  const { user, marketplace, apply } = parseArgs(process.argv.slice(2));
  const context = await NestFactory.createApplicationContext(BackfillRegistryModule, {
    logger: ['error', 'warn'],
  });
  try {
    console.log('─'.repeat(64));
    console.log(`  ПРОДАВЕЦ: ${user ?? 'все'}`);
    console.log(`  ПЛОЩАДКА: ${marketplace ?? 'все'}`);
    console.log(`  РЕЖИМ:    ${apply ? 'запись (--apply)' : 'dry run'}`);
    console.log('─'.repeat(64));

    const report = await backfillAccountingRegistry(context.get<TFinanceDb>(FINANCE_DB), {
      telegramUserId: user,
      marketplace,
      apply,
    });

    console.log(`Строк просмотрено: ${report.scanned}`);
    console.log(`${apply ? 'Обновлено' : 'Изменилось бы'}: ${report.changed}`);
    for (const [mp, subs] of Object.entries(report.distribution)) {
      console.log(`\n${mp}:`);
      const sorted = Object.entries(subs).sort((a, b) => b[1] - a[1]);
      for (const [sub, count] of sorted) {
        const title =
          ACCOUNTING_SUB_ARTICLE_TITLE[sub as keyof typeof ACCOUNTING_SUB_ARTICLE_TITLE];
        console.log(`  ${String(count).padStart(7)}  ${sub} — ${title}`);
      }
    }
    if (!apply) console.log('\nНичего не записано. Для реального запуска добавьте --apply');
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
