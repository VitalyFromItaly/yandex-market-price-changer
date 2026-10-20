import 'dotenv/config';

import type { IPnlReport } from '../src/modules/finance/finance.service';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import {
  FINANCE_MARKETPLACES,
  type TFinanceMarketplace,
} from '../src/database/postgres/finance.schema';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { EXPENSE_CATEGORIES, isPresetCategory } from '../src/modules/finance/expense.domain';
import {
  FINANCE_ARTICLE_KEYS,
  FINANCE_ARTICLE_META,
} from '../src/modules/finance/finance-articles';
import { parseMonthArg } from '../src/modules/finance/finance-period';
import { FINANCE_PERIOD_STATUS_LABEL } from '../src/modules/finance/finance-period-status';
import { FinanceModule } from '../src/modules/finance/finance.module';
import { FinanceService } from '../src/modules/finance/finance.service';
import { kopecksToRub } from '../src/modules/finance/kopecks';
import { PNL_SECTION } from '../src/modules/finance/pnl';

/**
 * P&L месяца из журнала (TASK-120) — для сверки с кабинетом ЯМ.
 *
 * Только чтение: тот же `FinanceService.build`, что будет звать экран
 * «Финансы». Журнал должен быть загружен заранее (`scripts/import-finance.ts`).
 * Для текущего месяца сервис строит и плоскую оценку — это запросы заказов к
 * Partner API (чтение).
 *
 * Nest без AppModule — довод diagnose-*: AppModule поднял бы BotRegistry, а он
 * перевешивает вебхук боевого бота.
 *
 * Запуск:
 *   npx ts-node scripts/pnl-finance.ts --user=<telegramUserId> --month=09-2026 [--marketplace=ozon|wb]
 *
 * `--marketplace=ozon` (TASK-131) или `wb` (TASK-136) — P&L журнала площадки тем
 * же движком; по умолчанию ЯМ. Площадки не складываются — это TASK-137.
 */

@Module({ imports: [AppConfigModule, ErrorsModule, FinanceModule] })
class PnlFinanceModule {}

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const user = get('user');
  const month = get('month');
  if (!user) throw new Error('Нужен --user=<telegramUserId>');
  const period = month ? parseMonthArg(month) : null;
  if (!period) throw new Error('Нужен --month=ММ-ГГГГ');
  const marketplace = get('marketplace') ?? 'ym';
  if (!isFinanceMarketplace(marketplace)) {
    throw new Error(`--marketplace: ${FINANCE_MARKETPLACES.join(' | ')}`);
  }
  return { user, period, marketplace };
}

function isFinanceMarketplace(value: string): value is TFinanceMarketplace {
  return (FINANCE_MARKETPLACES as readonly string[]).includes(value);
}

const rub = (kopecks: number) =>
  kopecksToRub(kopecks + 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 });
const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)} %`);
const line = (label: string, kopecks: number) =>
  console.log(`  ${label.padEnd(36)} ${rub(kopecks).padStart(18)}`);

function print(report: IPnlReport): void {
  const { pnl } = report;
  console.log(`  СТАТУС: ${report.statusLabel}`);
  for (const month of report.months) {
    const label = month.status ? FINANCE_PERIOD_STATUS_LABEL[month.status] : 'журнал не загружен';
    console.log(`    ${month.from} … ${month.to}: ${label}`);
  }
  console.log('─'.repeat(64));

  for (const section of ['revenue', 'other_income', 'marketplace', 'unrecognized'] as const) {
    for (const key of FINANCE_ARTICLE_KEYS) {
      const bucket = pnl.byArticle[key];
      if (PNL_SECTION[key] !== section || !bucket.operationIds.length) continue;
      line(`${FINANCE_ARTICLE_META[key].title} (${bucket.operationIds.length})`, bucket.kopecks);
    }
  }
  console.log('─'.repeat(64));
  line('Выручка', pnl.revenueKopecks);
  line('Прочие доходы', pnl.otherIncomeKopecks);
  line(`Себестоимость (${pnl.cogs.bySku.length} арт.)`, -pnl.cogs.kopecks);
  line(`Валовая прибыль · ${pct(pnl.grossMargin)}`, pnl.grossKopecks);
  line('Расходы площадки', pnl.marketplaceKopecks);
  line('Не распознано', pnl.unrecognizedKopecks);
  line('После расходов площадки', pnl.afterMarketplaceKopecks);
  for (const [category, kopecks] of Object.entries(pnl.operatingExpenses.byCategory)) {
    line(`  ${isPresetCategory(category) ? EXPENSE_CATEGORIES[category] : category}`, -kopecks);
  }
  line('Операционная прибыль', pnl.operatingKopecks);
  line(
    `Налог${pnl.tax.minimumApplied ? ' (минимальный)' : ''} от ${rub(pnl.tax.baseKopecks)}`,
    -pnl.tax.taxKopecks,
  );
  line(`ЧИСТАЯ ПРИБЫЛЬ · ${pct(pnl.netMargin)}`, pnl.netKopecks);
  console.log('─'.repeat(64));
  line('Справочно: оплачено баллами', pnl.reference.kopecks);
  if (pnl.tax.undatedLines) {
    console.log(`  Строк дохода без нужной даты (не выплачены?): ${pnl.tax.undatedLines}`);
  }
  if (report.taxIsDefault) console.log('  Налог — по умолчанию, продавец настройки не сохранял');
  if (!pnl.complete) {
    const skus = pnl.cogs.unknown.map((u) => `${u.sku || '(без артикула)'}×${u.count}`);
    console.log(
      `  ⚠ Нет закупа — чистая завышена (${skus.length}): ${skus.slice(0, 20).join(', ')}`,
    );
  }
  if (report.flat) {
    const f = report.flat;
    console.log(`  ${f.label} (плоская, ${f.block}): продажи ${f.revenue} ₽, чистая ${f.net} ₽`);
  } else if (report.flatNote) {
    console.log(`  ${report.flatNote}`);
  }
}

async function main(): Promise<void> {
  const { user, period, marketplace } = parseArgs(process.argv.slice(2));
  const context = await NestFactory.createApplicationContext(PnlFinanceModule, {
    logger: ['error', 'warn'],
  });
  try {
    console.log('─'.repeat(64));
    console.log(
      `  ПРОДАВЕЦ: ${user}   ПЕРИОД: ${period.from} … ${period.to}   ПЛОЩАДКА: ${marketplace}`,
    );
    const report = await context
      .get(FinanceService)
      .build(user, period, new Date(), { marketplace });
    console.log('─'.repeat(64));
    print(report);
    console.log('─'.repeat(64));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
