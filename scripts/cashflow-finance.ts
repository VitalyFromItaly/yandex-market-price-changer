import 'dotenv/config';

import type { ICashflowReport } from '../src/modules/finance/finance-cashflow.service';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { EXPENSE_CATEGORIES, isPresetCategory } from '../src/modules/finance/expense.domain';
import { FINANCE_ARTICLE_META } from '../src/modules/finance/finance-articles';
import { FinanceCashflowModule } from '../src/modules/finance/finance-cashflow.module';
import { FinanceCashflowService } from '../src/modules/finance/finance-cashflow.service';
import { parseMonthArg } from '../src/modules/finance/finance-period';
import { kopecksToRub } from '../src/modules/finance/kopecks';

/**
 * ДДС месяца, фактические выплаты и деньги к получению (TASK-122) — для сверки
 * с кабинетом ЯМ («Финансы → Платежи»). Только чтение: тот же
 * `FinanceCashflowService.build`, что у раздела CRM «Закупки». Журнал должен
 * быть загружен заранее (`scripts/import-finance.ts`). К Маркету не ходит.
 *
 * Nest без AppModule — довод diagnose-*: AppModule поднял бы BotRegistry, а он
 * перевешивает вебхук боевого бота.
 *
 * Запуск:
 *   npx ts-node scripts/cashflow-finance.ts --user=<telegramUserId> --month=10-2026
 */

@Module({ imports: [AppConfigModule, ErrorsModule, FinanceCashflowModule] })
class CashflowFinanceModule {}

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const user = get('user');
  const month = get('month');
  if (!user) throw new Error('Нужен --user=<telegramUserId>');
  const period = month ? parseMonthArg(month) : null;
  if (!period) throw new Error('Нужен --month=ММ-ГГГГ');
  return { user, period };
}

const rub = (kopecks: number) =>
  kopecksToRub(kopecks + 0).toLocaleString('ru-RU', { minimumFractionDigits: 2 });
const line = (label: string, kopecks: number) =>
  console.log(`  ${label.padEnd(40)} ${rub(kopecks).padStart(18)}`);

function print({ cashflow, receivable }: ICashflowReport): void {
  line('Поступления: выплаты Маркета', cashflow.inflow.payoutsKopecks);
  line('Выбытия: оплата закупок', -cashflow.outflow.purchasesKopecks);
  line('Выбытия: операционные расходы', -cashflow.outflow.expensesKopecks);
  for (const [category, kopecks] of Object.entries(cashflow.outflow.expensesByCategory)) {
    line(`  ${isPresetCategory(category) ? EXPENSE_CATEGORIES[category] : category}`, -kopecks);
  }
  line('Выбытия: уплаченные налоги', -cashflow.outflow.taxesKopecks);
  line('Итого за период', cashflow.netKopecks);
  console.log('─'.repeat(64));
  console.log(`  ВЫПЛАТЫ (${cashflow.payouts.length})`);
  for (const payout of cashflow.payouts) {
    const flag = payout.mismatch ? `  ≠ строк ${rub(payout.linesKopecks)}` : '';
    line(`${payout.day} № ${payout.bankOrderId ?? 'без номера'}${flag}`, payout.kopecks);
  }
  console.log('─'.repeat(64));
  console.log(`  К ПОЛУЧЕНИЮ на ${receivable.asOf} (${receivable.operationCount} операций)`);
  for (const row of receivable.byArticle) {
    line(`${FINANCE_ARTICLE_META[row.article].title} (${row.operationCount})`, row.kopecks);
  }
  line('Итого к получению', receivable.totalKopecks);
}

async function main(): Promise<void> {
  const { user, period } = parseArgs(process.argv.slice(2));
  const context = await NestFactory.createApplicationContext(CashflowFinanceModule, {
    logger: ['error', 'warn'],
  });
  try {
    console.log('─'.repeat(64));
    console.log(`  ПРОДАВЕЦ: ${user}   ПЕРИОД: ${period.from} … ${period.to}`);
    console.log('─'.repeat(64));
    print(await context.get(FinanceCashflowService).build(user, period));
    console.log('─'.repeat(64));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
