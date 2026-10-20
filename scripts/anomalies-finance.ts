import 'dotenv/config';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import {
  ANOMALY_KIND_LABEL,
  ANOMALY_KINDS,
  countAnomaliesByKind,
  rubText,
} from '../src/modules/finance/finance-anomalies';
import { FinanceAnomalyService } from '../src/modules/finance/finance-anomaly.service';
import { parseMonthArg } from '../src/modules/finance/finance-period';
import { FinanceModule } from '../src/modules/finance/finance.module';

/**
 * Аномалии журнала за месяц (TASK-149) — тем же `FinanceAnomalyService`, что
 * зовёт ночная загрузка. Без `--write` только печатает; с `--write` заменяет
 * список месяца в Postgres (отметки «просмотрено» не трогаются). Маркет не
 * спрашивается: журнал должен быть загружен заранее (`scripts/import-finance.ts`).
 *
 * Nest без AppModule — довод diagnose-*: AppModule поднял бы BotRegistry, а он
 * перевешивает вебхук боевого бота.
 *
 * Запуск:
 *   npx ts-node scripts/anomalies-finance.ts --user=<telegramUserId> --month=09-2026 [--write]
 */

@Module({ imports: [AppConfigModule, ErrorsModule, FinanceModule] })
class AnomaliesFinanceModule {}

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const user = get('user');
  const month = get('month');
  if (!user) throw new Error('Нужен --user=<telegramUserId>');
  const period = month ? parseMonthArg(month) : null;
  if (!period) throw new Error('Нужен --month=ММ-ГГГГ');
  return { user, period, write: argv.includes('--write') };
}

async function main(): Promise<void> {
  const { user, period, write } = parseArgs(process.argv.slice(2));
  const context = await NestFactory.createApplicationContext(AnomaliesFinanceModule, {
    logger: ['error', 'warn'],
  });
  try {
    const service = context.get(FinanceAnomalyService);
    const run = write
      ? await service.detectPeriod(user, period)
      : await service.detect(user, period);
    console.log('─'.repeat(72));
    console.log(`  ПРОДАВЕЦ: ${user}   ПЕРИОД: ${period.from} … ${period.to}`);
    console.log(`  ${write ? 'ЗАПИСАНО в finance_anomalies' : 'Только чтение (--write не задан)'}`);
    console.log('─'.repeat(72));
    const counts = countAnomaliesByKind(run.anomalies);
    for (const kind of ANOMALY_KINDS) {
      console.log(`  ${ANOMALY_KIND_LABEL[kind].padEnd(40)} ${String(counts[kind]).padStart(5)}`);
    }
    console.log('─'.repeat(72));
    for (const anomaly of run.anomalies) {
      const money = anomaly.amountKopecks === null ? '' : ` · ${rubText(anomaly.amountKopecks)}`;
      console.log(
        `  [${ANOMALY_KIND_LABEL[anomaly.kind]}]${money} · операций ${anomaly.operationCount}`,
      );
      console.log(`    ${anomaly.detail}`);
      console.log(`    порог: ${anomaly.threshold}`);
    }
    console.log('─'.repeat(72));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
