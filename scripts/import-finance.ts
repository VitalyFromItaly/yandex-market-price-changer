import 'dotenv/config';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { AppConfigModule } from '../src/config/app-config.module';
import { FINANCE_DB, type TFinanceDb } from '../src/database/postgres/finance-db';
import {
  FINANCE_MARKETPLACES,
  financeActServices,
  financeDiscrepancies,
  financeOperations as ops,
  financePeriods,
  type TFinanceMarketplace,
} from '../src/database/postgres/finance.schema';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { FINANCE_ARTICLE_META, isFinanceArticle } from '../src/modules/finance/finance-articles';
import { FinanceImportService } from '../src/modules/finance/finance-import.service';
import {
  FINANCE_REPORT_TYPE,
  financePeriodKey,
  parseMonthArg,
} from '../src/modules/finance/finance-period';
import { FINANCE_PERIOD_STATUS_LABEL } from '../src/modules/finance/finance-period-status';
import { RECONCILE_KIND_LABEL, RECONCILE_KINDS } from '../src/modules/finance/finance-reconcile';
import { kopecksToRub } from '../src/modules/finance/kopecks';
import { FinanceModule } from '../src/modules/finance/finance.module';
import { MarketplaceRegistry } from '../src/modules/marketplaces/marketplace-registry.service';
import { MarketplacesModule } from '../src/modules/marketplaces/marketplaces.module';

/**
 * Импорт журнала ЯМ (united-netting) за месяц — минуя очередь (TASK-111).
 *
 * Тот же `FinanceImportService`, что крутит процессор очереди finance-import:
 * заказ отчёта, ожидание, разбор, upsert операций, версия документа,
 * корректировки. Пишет ТОЛЬКО наш Postgres; Partner API — заказ отчёта (это заказ
 * файла, а не запись), reports/info и скачивание. Квота — 100 генераций в час.
 *
 * Nest поднимается без AppModule: тот поднял бы BotRegistry, а он перевешивает
 * вебхук боевого бота (довод diagnose-*). ErrorsModule — явно: @Global() не
 * втягивает модуль в контекст сам.
 *
 * После импорта печатает Σ живых операций периода по статьям и по актам — для
 * сверки с TASK-108 (Σ services = −Σ netting с той же actDate, до копейки).
 * Затем — статус периода и находки сверки с заказами (TASK-113): по видам и
 * первые десять.
 *
 * `--reconcile-only` — без заказа отчёта: сверка уже загруженного периода
 * (квоту генераций не тратит). Для «Проверено» нужны загруженные соседние
 * месяцы — сначала импортировать их.
 *
 * `--marketplace=ozon` (TASK-131) — журнал Ozon (/v3/finance/transaction/list)
 * через реестр площадок, как ночной проход: скрипты не импортируют клиентов
 * Ozon (тест границ). Сводка — по статьям и по типам операций Ozon (сверка
 * классификатора на живом ответе); актов и сверки с заказами у Ozon нет.
 *
 * `--marketplace=wb` (TASK-136) — отчёт реализации WB (reportDetailByPeriod) тем
 * же путём. Рядом с типами строк — Σ по недельным отчётам (`realizationreport_id`):
 * это «к перечислению», которое сверяется с кабинетом WB. Неделя на границе
 * месяцев видна здесь частью — вторая половина лежит в соседнем месяце.
 *
 * Запуск:
 *   npx ts-node scripts/import-finance.ts --user=<telegramUserId> --month=09-2026 [--reconcile-only]
 *   npx ts-node scripts/import-finance.ts --user=<telegramUserId> --month=09-2026 --marketplace=ozon
 *   npx ts-node scripts/import-finance.ts --user=<telegramUserId> --month=09-2026 --marketplace=wb
 */

@Module({ imports: [AppConfigModule, ErrorsModule, FinanceModule, MarketplacesModule] })
class ImportFinanceModule {}

function isFinanceMarketplace(value: string): value is TFinanceMarketplace {
  return (FINANCE_MARKETPLACES as readonly string[]).includes(value);
}

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
  const reconcileOnly = argv.includes('--reconcile-only');
  if (reconcileOnly && marketplace !== 'ym') {
    throw new Error('--reconcile-only — только для ЯМ: сверки с заказами у других площадок нет');
  }
  return { user, period, reconcileOnly, marketplace };
}

const rub = (kopecks: number) =>
  kopecksToRub(kopecks).toLocaleString('ru-RU', { minimumFractionDigits: 2 });

async function main(): Promise<void> {
  const { user, period, reconcileOnly, marketplace } = parseArgs(process.argv.slice(2));
  const context = await NestFactory.createApplicationContext(ImportFinanceModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    console.log('─'.repeat(64));
    console.log(`  ПРОДАВЕЦ: ${user}`);
    console.log(`  ПЕРИОД:   ${period.from} … ${period.to}`);
    console.log(`  ПЛОЩАДКА: ${marketplace}`);
    console.log(`  БАЗА:     ${process.env.MONGODB_DATABASE}`);
    console.log('─'.repeat(64));

    const started = Date.now();
    const finance = context.get(FinanceImportService);
    const request = { telegramUserId: user, period };
    let result: unknown;
    if (marketplace !== 'ym') {
      result = await context
        .get(MarketplaceRegistry)
        .require(marketplace, 'finance', user)
        .importFinance({ telegramUserId: user, marketplace }, period);
    } else {
      result = reconcileOnly
        ? await finance.reconcileAndRecord(request)
        : await finance.importAndRecord(request);
    }
    console.log(`Итог (${Math.round((Date.now() - started) / 1000)} с):`, result);

    // Сводка — SQL GROUP BY по живым операциям периода: ради таких сумм
    // финансы и переехали в Postgres (решение finance_postgres).
    const db = context.get<TFinanceDb>(FINANCE_DB);
    const periodKey = financePeriodKey(FINANCE_REPORT_TYPE[marketplace], period);
    const live = and(
      eq(ops.marketplace, marketplace),
      eq(ops.telegramUserId, user),
      eq(ops.periodKey, periodKey),
      isNull(ops.supersededAt),
    );
    const byArticle = await db
      .select({
        article: ops.article,
        count: sql<number>`count(*)::int`,
        sum: sql<number>`sum(${ops.amountKopecks})::bigint`,
      })
      .from(ops)
      .where(live)
      .groupBy(ops.article)
      .orderBy(sql`sum(${ops.amountKopecks})`);
    // actDate — начало суток по Москве; день считаем в той же зоне.
    const actDay = sql<string>`to_char(${ops.actDate} AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD')`;
    const byAct =
      marketplace === 'ym'
        ? await db
            .select({ day: actDay, sum: sql<number>`sum(${ops.amountKopecks})::bigint` })
            .from(ops)
            .where(and(live, sql`${ops.actDate} IS NOT NULL`))
            .groupBy(actDay)
            .orderBy(actDay)
        : [];

    const total = byArticle.reduce((n, a) => n + Number(a.count), 0);
    console.log(`\nЖивых операций периода: ${total}`);
    for (const a of byArticle) {
      const meta = isFinanceArticle(a.article) ? FINANCE_ARTICLE_META[a.article] : undefined;
      console.log(
        `  ${(meta?.title ?? a.article).padEnd(36)} ${(meta?.group ?? '?').padEnd(10)}` +
          `${String(a.count).padStart(7)} стр.  ${rub(Number(a.sum)).padStart(16)} ₽`,
      );
    }
    if (marketplace !== 'ym') {
      // Типы операций площадки — сверка классификатора на живом ответе: тип со
      // статьёй «не распознано» — строка, которую пора дописать в <площадка>-articles.ts.
      const byType = await db
        .select({
          type: ops.transactionType,
          article: ops.article,
          count: sql<number>`count(*)::int`,
          sum: sql<number>`sum(${ops.amountKopecks})::bigint`,
        })
        .from(ops)
        .where(live)
        .groupBy(ops.transactionType, ops.article)
        .orderBy(ops.transactionType);
      console.log(`\nПо типам операций ${marketplace} (статья строки целиком):`);
      for (const t of byType) {
        console.log(
          `  ${t.type.padEnd(52)} ${t.article.padEnd(18)}${String(t.count).padStart(7)} шт.  ` +
            `${rub(Number(t.sum)).padStart(16)} ₽`,
        );
      }
    }
    if (marketplace === 'wb') {
      const reportId = sql<string>`${ops.raw}->>'realizationreport_id'`;
      const byReport = await db
        .select({
          report: reportId,
          count: sql<number>`count(*)::int`,
          sum: sql<number>`sum(${ops.amountKopecks})::bigint`,
        })
        .from(ops)
        .where(live)
        .groupBy(reportId)
        .orderBy(reportId);
      console.log('\nК перечислению по недельным отчётам WB (сверить с кабинетом):');
      for (const r of byReport) {
        console.log(
          `  отчёт ${String(r.report).padEnd(14)}${String(r.count).padStart(7)} строк  ` +
            `${rub(Number(r.sum)).padStart(16)} ₽`,
        );
      }
    }
    // Рядом — итог акта из отчёта услуг (TASK-158). Здесь — строки ЭТОГО периода,
    // а сверка сравнивает с −Σ по ВСЕМУ журналу: строки акта лежат в отчётах двух
    // месяцев, и разница в этой таблице — ещё не расхождение (оно — в находках).
    const services = await db
      .select({ day: financeActServices.actDay, total: financeActServices.totalKopecks })
      .from(financeActServices)
      .where(eq(financeActServices.telegramUserId, user));
    const servicesBy = new Map(services.map((s) => [s.day, Number(s.total)]));
    console.log('\nΣ по актам (actDate, МСК):  строки периода / отчёт услуг / разница');
    for (const a of byAct) {
      const total = servicesBy.get(a.day);
      const tail =
        total === undefined
          ? '  отчёта услуг нет'
          : `  ${rub(total).padStart(16)} ₽  ${rub(total + Number(a.sum)).padStart(12)} ₽`;
      console.log(`  ${a.day}  ${rub(Number(a.sum)).padStart(16)} ₽${tail}`);
    }

    const [state] = await db
      .select()
      .from(financePeriods)
      .where(
        and(
          eq(financePeriods.marketplace, marketplace),
          eq(financePeriods.telegramUserId, user),
          eq(financePeriods.periodKey, periodKey),
        ),
      );
    if (state) {
      console.log(
        `\nСтатус: ${FINANCE_PERIOD_STATUS_LABEL[state.status]} · сверка ${state.reconcileState ?? '—'}` +
          (state.reconcileNote ? ` (${state.reconcileNote})` : ''),
      );
    }
    const found = await db
      .select()
      .from(financeDiscrepancies)
      .where(
        and(
          eq(financeDiscrepancies.telegramUserId, user),
          eq(financeDiscrepancies.periodKey, periodKey),
        ),
      );
    console.log(`Находок сверки: ${found.length}`);
    for (const kind of RECONCILE_KINDS) {
      const ofKind = found.filter((f) => f.kind === kind);
      if (!ofKind.length) continue;
      console.log(`  ${RECONCILE_KIND_LABEL[kind]}: ${ofKind.length}`);
      for (const f of ofKind.slice(0, 10)) console.log(`    ${f.detail}`);
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
