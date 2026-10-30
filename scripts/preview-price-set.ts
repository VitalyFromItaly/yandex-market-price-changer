import 'dotenv/config';

import type { IPriceSetRequest } from '../src/modules/price-set/price-set.domain';
import type { TMarketplace } from '../src/shared/marketplace';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { AppConfigModule } from '../src/config/app-config.module';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { PRICE_FILE_BAD_TEXT, parsePriceFile } from '../src/modules/price-set/price-set-file';
import {
  PRICE_SET_BLOCK_TEXT,
  PRICE_SET_SKIP_TEXT,
  isMarkupPercent,
} from '../src/modules/price-set/price-set.domain';
import { PriceSetModule } from '../src/modules/price-set/price-set.module';
import { PriceSetService } from '../src/modules/price-set/price-set.service';
import { allFeaturesEnabled } from '../src/modules/telegram/bots/shared/features.domain';
import { MARKETPLACES } from '../src/shared/marketplace';

/**
 * «Установка цен» (TASK-202) — dry-run: печатает план «было → стало» по каждой
 * площадке. НИЧЕГО не пишет ни в площадки, ни в Mongo: зовёт только
 * `PriceSetService.plan`, запись (`apply`) здесь недостижима.
 *
 * Из площадок — только чтение текущих цен. Фичи — как у админа (все открыты),
 * поэтому «только просмотр» здесь не показывается: запись открыта везде.
 *
 * Без AppModule: он поднял бы BotRegistry, а тот переставил бы вебхук. Реестр
 * площадок тянет финансы — нужен `POSTGRES_URL`.
 *
 * Запуск:
 *   npx ts-node scripts/preview-price-set.ts --user=<telegramUserId> --markup=ym:250,ozon:300 [--rows=20]
 *   npx ts-node scripts/preview-price-set.ts --user=<telegramUserId> --file=<путь.xlsx|csv> --to=ym,wb
 */

@Module({ imports: [AppConfigModule, ErrorsModule, PriceSetModule] })
class PreviewModule {}

function arg(args: readonly string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function isMarketplace(value: string): value is TMarketplace {
  return (MARKETPLACES as readonly string[]).includes(value);
}

function requestOf(args: readonly string[]): IPriceSetRequest {
  const markup = arg(args, 'markup');
  const file = arg(args, 'file');
  if (markup) {
    const percents: Partial<Record<TMarketplace, number>> = {};
    for (const pair of markup.split(',')) {
      const [mp, value] = pair.split(':');
      const percent = Number(value);
      if (!isMarketplace(mp) || !isMarkupPercent(percent)) {
        throw new Error(`--markup: «${pair}» — нужно площадка:процент, например ym:250`);
      }
      percents[mp] = percent;
    }
    return {
      desired: { source: 'markup', percents },
      marketplaces: MARKETPLACES.filter((mp) => percents[mp] !== undefined),
    };
  }
  if (file) {
    const to = (arg(args, 'to') ?? MARKETPLACES.join(',')).split(',');
    if (!to.every(isMarketplace)) throw new Error('--to: площадки через запятую — ym,ozon,wb');
    const parsed = parsePriceFile(readFileSync(file), basename(file));
    console.log(
      `Файл: лист «${parsed.sheet}», строк ${parsed.rows.length}, битых ${parsed.bad.length}`,
    );
    for (const bad of parsed.bad.slice(0, 10)) {
      console.log(`  строка ${bad.row} ${bad.sku ?? ''}: ${PRICE_FILE_BAD_TEXT[bad.reason]}`);
    }
    return {
      desired: { source: 'file', rows: parsed.rows.map(({ sku, price }) => ({ sku, price })) },
      marketplaces: MARKETPLACES.filter((mp) => (to as string[]).includes(mp)),
    };
  }
  throw new Error('Нужен --markup=ym:250,… или --file=<путь>');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const user = arg(args, 'user');
  if (!user) throw new Error('Нужен --user=<telegramUserId>');
  const rows = Number(arg(args, 'rows') ?? 20);
  const request = requestOf(args);

  const app = await NestFactory.createApplicationContext(PreviewModule, {
    logger: ['error', 'warn'],
  });
  try {
    const { plan, priceListAt, readErrors, notConsidered } = await app
      .get(PriceSetService)
      .plan(user, allFeaturesEnabled(), request);

    if (plan.source === 'markup') console.log(`Закуп из прайса обновлён: ${priceListAt ?? 'нет'}`);
    for (const n of notConsidered) console.log(`  — ${n.marketplace}: ${n.reason}`);

    for (const target of plan.targets) {
      console.log(
        `\n${target.marketplace}: ` +
          `${target.blockedBy ? `ЗАБЛОКИРОВАНО — ${PRICE_SET_BLOCK_TEXT[target.blockedBy]}` : 'писали бы'}`,
      );
      const error = readErrors[target.marketplace];
      if (error) console.log(`  причина: ${error}`);
      const risky = target.updates.filter((row) => row.risky).length;
      console.log(
        `  к записи ${target.updates.length} (рискованных ${risky}), ` +
          `без изменений ${target.unchanged}, пропущено ${target.skipped.length}`,
      );
      for (const row of target.updates.slice(0, rows)) {
        const delta = row.delta === null ? '—' : `${(row.delta * 100).toFixed(1)}%`;
        console.log(
          `  ${row.sku.padEnd(30)} ${String(row.from ?? '—').padStart(8)} → ${String(row.to).padStart(8)}` +
            ` (${delta}${row.send !== row.to ? `, в API ${row.send}` : ''})${row.risky ? ' ⚠' : ''}`,
        );
      }
      if (target.updates.length > rows) console.log(`  …ещё ${target.updates.length - rows}`);

      const reasons = new Map<string, number>();
      for (const s of target.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
      for (const [reason, count] of reasons) {
        console.log(
          `  пропущено — ${PRICE_SET_SKIP_TEXT[reason as keyof typeof PRICE_SET_SKIP_TEXT]}: ${count}`,
        );
      }
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
