import 'dotenv/config';

import type { ICostRecord } from '../src/modules/products/cost-history.domain';
import type { Model } from 'mongoose';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';

import { AppConfigModule } from '../src/config/app-config.module';
import { DatabaseModule } from '../src/database/database.module';
import { PostgresModule } from '../src/database/postgres/postgres.module';
import { AccountingCostHistoryRepository } from '../src/database/postgres/repositories/accounting-cost-history.repository';
import { CostHistory } from '../src/database/schemas/cost-history.schema';
import { costHistoryCarryOver } from '../src/modules/accounting/accounting-cost-history.domain';
import { ErrorsModule } from '../src/modules/errors/errors.module';

/**
 * Перенос истории себестоимости в историю закупа v2 «Финучёта» (TASK-213,
 * решение `accounting_cost_history_v2`). Читает Mongo `CostHistory` продавца,
 * пишет ТОЛЬКО наш Postgres (`accounting_cost_records`, `source: 'cost-history'`).
 *
 * - датированная запись (`validFrom: 'ГГГГ-ММ-ДД'`) → начало её московского дня;
 * - стартовая (`validFrom: null`, «с начала времён») НЕ переносится: v2 строгая,
 *   продажи до первой известной цены — «Неизвестная закупка»;
 * - запись на тот же момент уже есть (повтор, ручное исправление) — не трогается.
 *
 * `CostHistory` не меняется. Без `--apply` — dry run: печатает, сколько записей
 * добавилось бы. Таблица должна уже быть: приложение мигрирует себя на старте,
 * иначе — `npm run db:pg:migrate`. Nest поднимается без AppModule (довод diagnose-*).
 *
 * Запуск:
 *   npx ts-node scripts/backfill-accounting-cost-history.ts --user=<telegramUserId> [--apply]
 */

@Module({ imports: [AppConfigModule, ErrorsModule, DatabaseModule, PostgresModule] })
class BackfillCostHistoryModule {}

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const user = get('user');
  if (!user) throw new Error('--user=<telegramUserId> обязателен');
  return { user, apply: argv.includes('--apply') };
}

async function main(): Promise<void> {
  const { user, apply } = parseArgs(process.argv.slice(2));
  const context = await NestFactory.createApplicationContext(BackfillCostHistoryModule, {
    logger: ['error', 'warn'],
  });
  try {
    const model = context.get<Model<CostHistory>>(getModelToken(CostHistory.name));
    const repository = context.get(AccountingCostHistoryRepository);

    const docs = await model.find({ telegramUserId: user }).lean().exec();
    const byProduct = new Map<string, ICostRecord[]>();
    for (const doc of docs) {
      const list = byProduct.get(doc.productId) ?? [];
      list.push(doc as unknown as ICostRecord);
      byProduct.set(doc.productId, list);
    }
    const writes = [...byProduct].flatMap(([productId, records]) =>
      costHistoryCarryOver(productId, records),
    );
    const baselines = docs.filter((doc) => doc.validFrom === null).length;

    console.log('─'.repeat(64));
    console.log(`  ПРОДАВЕЦ: ${user}`);
    console.log(`  РЕЖИМ:    ${apply ? 'запись (--apply)' : 'dry run'}`);
    console.log('─'.repeat(64));
    console.log(`Записей CostHistory: ${docs.length} (товаров ${byProduct.size})`);
    console.log(`Стартовых (не переносятся): ${baselines}`);
    console.log(`К переносу: ${writes.length}`);

    if (apply) {
      const inserted = await repository.insertMany(user, writes);
      console.log(`Добавлено: ${inserted} (уже были: ${writes.length - inserted})`);
    } else {
      const existing = await repository.recordsFor(
        user,
        writes.map((write) => write.productId),
      );
      const fresh = writes.filter(
        (write) =>
          !(existing.get(write.productId) ?? []).some(
            (row) => row.validFrom.getTime() === write.validFrom.getTime(),
          ),
      );
      console.log(`Добавилось бы: ${fresh.length}`);
      console.log('\nНичего не записано. Для реального запуска добавьте --apply');
    }
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
