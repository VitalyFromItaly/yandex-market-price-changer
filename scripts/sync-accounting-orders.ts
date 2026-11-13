import 'dotenv/config';

import type { TFinanceMarketplace } from '../src/database/postgres/finance.schema';
import type { IAccountingOrdersSyncReport } from '../src/modules/accounting/accounting-orders.service';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { AccountingOrderLineRepository } from '../src/database/postgres/repositories/accounting-order-line.repository';
import { AccountingModule } from '../src/modules/accounting/accounting.module';
import {
  AccountingOrdersService,
  AccountingOrdersSyncError,
} from '../src/modules/accounting/accounting-orders.service';
import { ErrorsModule } from '../src/modules/errors/errors.module';

/**
 * Снимок строк заказов «Финучёта» (ЯМ — TASK-210, Ozon/WB — TASK-211) для
 * одного продавца — тот же `AccountingOrdersService.syncUser`, что зовёт
 * очередь `accounting-orders`.
 *
 * Что пишет: только наш Postgres — `accounting_order_lines`,
 * `accounting_order_line_versions`, `accounting_order_sync_state`. В площадки —
 * только чтение: ЯМ `GET /campaigns/{id}/orders` по всем магазинам кабинета,
 * Ozon — списки отправлений FBS/FBO за 29 дней, WB — supplier/orders и
 * supplier/sales «Статистики» (≥ 61 с выдержки на страницу).
 * Права (`fin_accounting`) не проверяет: это ручной прогон. Nest поднимается без
 * AppModule (довод diagnose-*: BotRegistry перевесил бы вебхук).
 *
 * Запуск:
 *   npx ts-node scripts/sync-accounting-orders.ts --user=<telegramUserId> [--marketplace=ym] [--days=7] [--from-cursor]
 *     --marketplace  ym | ozon | wb | all, по умолчанию ym;
 *     --days         окно обновлений заказов в днях (1–29), по умолчанию 7, курсор и часовой
 *                    интервал Ozon/WB игнорируются (окно Ozon — всегда 29 дней по началу обработки);
 *     --from-cursor  окно как у очереди: от последнего успеха с нахлёстом 30 минут.
 */

@Module({ imports: [AppConfigModule, ErrorsModule, AccountingModule] })
class SyncAccountingOrdersModule {}

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const user = get('user');
  if (!user) throw new Error('Нужно --user=<telegramUserId>');
  const days = Number(get('days') ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 29) throw new Error('--days: целое от 1 до 29');
  const marketplace = get('marketplace') ?? 'ym';
  const all: TFinanceMarketplace[] = ['ym', 'ozon', 'wb'];
  const marketplaces = marketplace === 'all' ? all : all.filter((key) => key === marketplace);
  if (!marketplaces.length) throw new Error('--marketplace: ym | ozon | wb | all');
  return { user, days, marketplaces, fromCursor: argv.includes('--from-cursor') };
}

async function main(): Promise<void> {
  const { user, days, marketplaces, fromCursor } = parseArgs(process.argv.slice(2));
  const context = await NestFactory.createApplicationContext(SyncAccountingOrdersModule, {
    logger: ['error', 'warn'],
  });
  try {
    let report: IAccountingOrdersSyncReport;
    try {
      report = await context
        .get(AccountingOrdersService)
        .syncUser(user, { marketplaces, firstDays: days, ignoreCursor: !fromCursor });
    } catch (error) {
      if (!(error instanceof AccountingOrdersSyncError)) throw error;
      report = error.report;
      process.exitCode = 1;
    }
    const repo = context.get(AccountingOrderLineRepository);
    console.log(`Продавец ${user}`);
    for (const marketplace of marketplaces) {
      const result = report.results[marketplace];
      const state = await repo.syncState(user, marketplace);
      console.log(`\n[${marketplace}] ${result?.outcome ?? '—'}`);
      if (result && 'error' in result) console.log(`Ошибка: ${result.error}`);
      if (result && 'seen' in result) {
        if (result.window) console.log(`Окно: ${result.window.from} … ${result.window.to}`);
        console.log(
          `Магазинов ${result.campaigns}, заказов ${result.orders}, строк ${result.seen}, ` +
            `новых ${result.created}, изменено ${result.changed}`,
        );
      }
      console.log(
        `Состояние: последний успех ${state?.lastSuccessAt?.toISOString() ?? '—'}, ` +
          `версий записано ${state?.versionsWritten ?? 0}`,
      );
    }
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
