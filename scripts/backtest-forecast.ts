import 'dotenv/config';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { financeToday, monthPeriod, shiftDay } from '../src/modules/finance/finance-period';
import { FinanceModule } from '../src/modules/finance/finance.module';
import { FinanceService } from '../src/modules/finance/finance.service';
import { backtestOf, FORECAST_BASIS_DAYS } from '../src/modules/finance/forecast';
import { kopecksToRub } from '../src/modules/finance/kopecks';

/**
 * Бэктест прогноза (TASK-151): то же линейное правило, что «Прогнозы», на
 * закрытых месяцах — прогноз выручки, сделанный утром 7/14/21 числа при окне
 * 14/28/56 дней, против факта месяца. Печатает строки и среднюю ошибку (MAPE).
 *
 * Только чтение журнала: один `FinanceService.build` по всему отрезку (с запасом
 * 56 дней на окно), ряд — `pnl.salesByDay`. Выручка от закупа не зависит, к
 * Маркету скрипт не ходит (`flat: false`). Nest без AppModule — довод diagnose-*.
 *
 * Запуск:
 *   npx ts-node scripts/backtest-forecast.ts --user=<telegramUserId> [--months=6]
 */

@Module({ imports: [AppConfigModule, ErrorsModule, FinanceModule] })
class BacktestForecastModule {}

const CUT_DAYS = [7, 14, 21];

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const user = get('user');
  if (!user) throw new Error('Нужен --user=<telegramUserId>');
  const months = Number(get('months') ?? 6);
  if (!Number.isInteger(months) || months < 1 || months > 9) throw new Error('--months: 1…9');
  return { user, months };
}

const rub = (kopecks: number) =>
  kopecksToRub(kopecks).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)} %`);

async function main(): Promise<void> {
  const { user, months: count } = parseArgs(process.argv.slice(2));
  const today = financeToday();
  const [year, month] = today.split('-').map(Number);
  const months = [];
  for (let shift = count; shift >= 1; shift -= 1) {
    const index = year * 12 + month - 1 - shift;
    months.push(monthPeriod(Math.floor(index / 12), (index % 12) + 1));
  }
  const maxBasis = Math.max(...FORECAST_BASIS_DAYS);
  const range = { from: shiftDay(months[0].from, -maxBasis), to: months[months.length - 1].to };

  const app = await NestFactory.createApplicationContext(BacktestForecastModule, {
    logger: ['error', 'warn'],
  });
  try {
    const report = await app.get(FinanceService).build(user, range, new Date(), { flat: false });
    const missing = report.months.filter((m) => m.status === null).map((m) => m.from.slice(0, 7));
    console.log(
      `Отрезок ${range.from} … ${range.to}, журнал не загружен: ${missing.join(', ') || 'нет'}`,
    );

    const { rows, summary } = backtestOf(report.pnl.salesByDay, months, CUT_DAYS, [
      ...FORECAST_BASIS_DAYS,
    ]);
    console.log('\nМЕСЯЦ    ОТСЕЧКА  ОКНО   ПРОГНОЗ ₽       ФАКТ ₽          ОШИБКА');
    for (const r of rows) {
      console.log(
        `${r.month}  ${String(r.cutDay).padStart(7)}  ${String(r.basisDays).padStart(4)}  ` +
          `${rub(r.forecastKopecks).padStart(14)}  ${rub(r.actualKopecks).padStart(14)}  ${pct(r.error).padStart(8)}`,
      );
    }
    console.log('\nСРЕДНЯЯ ОШИБКА (MAPE)');
    for (const s of summary) {
      console.log(
        `  окно ${s.basisDays} дн., ${s.cutDay}-е число: ${pct(s.mape)} по ${s.months} мес.`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
