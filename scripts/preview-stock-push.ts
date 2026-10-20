import 'dotenv/config';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { STOCK_PUSH_BLOCK_TEXT, STOCK_PUSH_SKIP_TEXT } from '../src/modules/finance/stock-push';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { StockPushModule } from '../src/modules/stock-push/stock-push.module';
import { StockPushService } from '../src/modules/stock-push/stock-push.service';
import { allFeaturesEnabled } from '../src/modules/telegram/bots/shared/features.domain';

/**
 * «Передача остатков» (TASK-143) — dry-run: печатает план «что бы записали» по
 * каждой площадке. НИЧЕГО не пишет ни в Маркет, ни в Mongo: зовёт только
 * `StockPushService.plan`, запись (`apply`) здесь недостижима.
 *
 * Из площадок — только чтение (заказы за 30 дней, остатки). Площадки — как у
 * админа (все фичи открыты): Ozon/WB спрашиваются, если подключены.
 *
 * Без AppModule: он поднял бы BotRegistry, а тот переставил бы вебхук. Реестр
 * площадок тянет финансы — нужен `POSTGRES_URL`.
 *
 * Запуск:
 *   npx ts-node scripts/preview-stock-push.ts --user=<telegramUserId> [--rows=20]
 */

@Module({ imports: [AppConfigModule, ErrorsModule, StockPushModule] })
class PreviewModule {}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const user = args.find((a) => a.startsWith('--user='))?.split('=')[1];
  if (!user) throw new Error('Нужен --user=<telegramUserId>');
  const rows = Number(args.find((a) => a.startsWith('--rows='))?.split('=')[1] ?? 20);

  const app = await NestFactory.createApplicationContext(PreviewModule, {
    logger: ['error', 'warn'],
  });
  try {
    const { plan, notConsidered } = await app
      .get(StockPushService)
      .plan(user, allFeaturesEnabled());

    console.log(`Последний прайс: ${plan.priceListDay ?? 'нет'}`);
    console.log(`Заказы прочитаны: ${plan.ordersKnown ? 'да' : 'НЕТ'}`);
    for (const e of plan.orderErrors) console.log(`  ! заказы ${e.source}: ${e.error}`);
    for (const n of notConsidered) console.log(`  — ${n.marketplace}: ${n.reason}`);

    for (const target of plan.targets) {
      console.log(
        `\n${target.marketplace} «${target.name}» (${target.placement ?? '?'}): ` +
          `${target.blockedBy ? `ЗАБЛОКИРОВАНО — ${STOCK_PUSH_BLOCK_TEXT[target.blockedBy]}` : 'писали бы'}`,
      );
      if (target.error) console.log(`  причина: ${target.error}`);
      console.log(
        `  к записи ${target.updates.length}, обнулений ${target.zeroed}, ` +
          `без изменений ${target.unchanged}, нет в остатках ${target.notListed}`,
      );
      for (const row of target.updates.slice(0, rows)) {
        console.log(
          `  ${row.sku.padEnd(30)} прайс ${row.priceListStock} − продано ${row.sold}: ${row.from} → ${row.to}`,
        );
      }
      if (target.updates.length > rows) console.log(`  …ещё ${target.updates.length - rows}`);
    }

    const reasons = new Map<string, number>();
    for (const s of plan.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    console.log(`\nВне плана: ${plan.skipped.length}`);
    for (const [reason, count] of reasons) {
      console.log(
        `  ${STOCK_PUSH_SKIP_TEXT[reason as keyof typeof STOCK_PUSH_SKIP_TEXT]}: ${count}`,
      );
    }
    console.log(`\nОтпечаток плана: ${plan.planHash}`);
    console.log('Ничего не записано.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
