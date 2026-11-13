import 'dotenv/config';

import type { TFinanceMarketplace } from '../src/database/postgres/finance.schema';
import type { IOrderResultSnapshotWrite } from '../src/database/postgres/repositories/accounting-order-result.repository';
import type { IComputedOrder } from '../src/modules/accounting/accounting-order-card.service';
import type {
  IAccountingReconcileResult,
  IReconcileCandidate,
} from '../src/modules/accounting/accounting-reconcile.domain';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { AccountingOrderLineRepository } from '../src/database/postgres/repositories/accounting-order-line.repository';
import { FinanceOperationRepository } from '../src/database/postgres/repositories/finance-operation.repository';
import { YandexMarketService } from '../src/database/services/yandex-market.service';
import { AccountingCogsService } from '../src/modules/accounting/accounting-cogs.service';
import { AccountingManualOperationsService } from '../src/modules/accounting/accounting-manual-operations.service';
import { AccountingOrderCardService } from '../src/modules/accounting/accounting-order-card.service';
import {
  RECONCILE_CANDIDATE_REASON_LABEL,
  RECONCILE_STATUS_LABEL,
} from '../src/modules/accounting/accounting-reconcile.domain';
import {
  AccountingReconcileService,
  parseReconcileMonth,
} from '../src/modules/accounting/accounting-reconcile.service';
import { AccountingStoreCostsService } from '../src/modules/accounting/accounting-store-costs.service';
import { AccountingTaxService } from '../src/modules/accounting/accounting-tax.service';
import { AccountingModule } from '../src/modules/accounting/accounting.module';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { ORDER_PROFIT_STATE_TITLE } from '../src/modules/accounting/order-profit-state';
import { ORDER_RESULT_TITLE, isReturnedOrderLine } from '../src/modules/accounting/order-result';
import { returnOfOrder } from '../src/modules/accounting/accounting-returns.domain';
import { RETURN_RESULT_TITLE } from '../src/modules/accounting/return-result';
import { ErrorsModule } from '../src/modules/errors/errors.module';
import { PriceCalcRatesService } from '../src/modules/finance/price-calc-rates.service';
import { allFeaturesEnabled } from '../src/modules/telegram/bots/shared/features.domain';

/**
 * Живой прогон «Финучёта» по продавцу за месяц оформления (TASK-232, приёмка ТЗ п.15 №1, №3, №7):
 *   ЗАКАЗЫ   — результат каждого заказа ровно как его карточка в CRM (`AccountingOrderCardService.periodOrders`:
 *              операции журнала + ручные, закуп v2/партии, распределение, налог, состояние прибыли);
 *   ВОЗВРАТЫ — `returnResultOf` по возвращённым заказам месяца (логистика, удержания, компенсации, результат);
 *   СВЕРКА   — сверка v2 (`AccountingReconcileService`, TASK-226): статьи, акты, поручения, кандидаты.
 *
 * Ничего не пишет: снимок результата заказа (`AccountingOrderResultRepository.recordSnapshot`) подменён
 * заглушкой, остальной путь только читает Postgres и Mongo; площадки не зовутся, `finance_periods` и
 * `finance_discrepancies` не пишутся. Фичи — все открыты (как у админа), площадки — подключённые продавцу.
 * ЯМ — активный магазин продавца. Nest поднимается без AppModule (довод diagnose-*: BotRegistry перевесил
 * бы вебхук) — тот же набор модулей, что у sync-accounting-orders.
 *
 * Запуск:
 *   npx ts-node scripts/diagnose-accounting.ts --user=<telegramUserId> --month=ГГГГ-ММ
 *     [--marketplace=ym|ozon|wb]          площадка (по умолчанию ym)
 *     [--section=orders,returns,reconcile] какие разделы печатать (по умолчанию все)
 *     [--orders=20]                       сколько заказов печатать построчно (итоги — по всем)
 *     [--candidates=20]                   сколько кандидатов расхождения печатать на статью
 */

@Module({ imports: [AppConfigModule, ErrorsModule, AccountingModule] })
class DiagnoseAccountingModule {}

const MARKETPLACES: readonly TFinanceMarketplace[] = ['ym', 'ozon', 'wb'];
const SECTIONS = ['orders', 'returns', 'reconcile'] as const;
type TSection = (typeof SECTIONS)[number];

const rub = (kopecks: number | null) =>
  kopecks === null
    ? '—'
    : `${(kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const user = get('user');
  const period = parseReconcileMonth(get('month'));
  if (!user || !period) {
    throw new Error('Нужно --user=<telegramUserId> --month=ГГГГ-ММ');
  }
  const marketplace = (get('marketplace') ?? 'ym') as TFinanceMarketplace;
  if (!MARKETPLACES.includes(marketplace)) throw new Error('--marketplace: ym | ozon | wb');
  const sections = new Set((get('section') ?? SECTIONS.join(',')).split(',') as TSection[]);
  for (const section of sections) {
    if (!SECTIONS.includes(section)) throw new Error(`--section: ${SECTIONS.join(', ')}`);
  }
  return {
    user,
    period,
    marketplace,
    sections,
    orders: Number(get('orders') ?? 20),
    candidates: Number(get('candidates') ?? 20),
  };
}

function printCandidates(items: readonly IReconcileCandidate[], limit: number): void {
  for (const c of items.slice(0, limit)) {
    console.log(
      `      ${c.matchesDifference ? '=' : ' '} ${RECONCILE_CANDIDATE_REASON_LABEL[c.reason].padEnd(22)} ` +
        `${rub(c.amountKopecks).padStart(14)}  заказ ${c.orderId ?? '—'}  ${c.accruedOn}` +
        `  акт ${c.actDay ?? '—'}  ${c.source === 'manual' ? 'ручная ' : ''}${c.serviceName ?? c.article}`,
    );
  }
}

function printReconcile(result: IAccountingReconcileResult, limit: number): void {
  console.log(
    `\nСВЕРКА:  ${RECONCILE_STATUS_LABEL[result.status]}${result.partial ? ' (сверено не всё)' : ''}`,
  );
  console.log(`Сверено: ${result.reconciledAt}   данные на: ${result.dataAsOf ?? '—'}`);
  for (const note of result.notes) console.log(`  · ${note}`);
  const without = result.lines
    .filter((l) => l.status === 'no_document' && l.operationCount > 0)
    .map((l) => l.title);
  if (without.length) console.log(`  · Без документа: ${without.join(', ')}`);

  console.log('\nСТАТЬИ');
  for (const line of result.lines) {
    console.log(
      `  ${line.title.padEnd(26)} реестр ${rub(line.registryKopecks).padStart(16)}` +
        `  документ ${rub(line.documentKopecks).padStart(16)}` +
        `  разница ${rub(line.differenceKopecks).padStart(14)}  ${line.status}` +
        (line.manualKopecks ? `  (ручные ${rub(line.manualKopecks)})` : ''),
    );
    if (line.reason) console.log(`      ${line.reason}`);
    if (line.candidates.count) {
      console.log(`      кандидатов: ${line.candidates.count}`);
      printCandidates(line.candidates.items, limit);
    }
  }

  console.log('\nАКТЫ (итог отчёта услуг против −Σ строк дня акта)');
  for (const act of result.acts) {
    console.log(
      `  ${act.actDay}  журнал ${rub(act.registryKopecks).padStart(16)}  отчёт ${rub(act.documentKopecks).padStart(16)}` +
        `  ${act.status}${act.unknownSheets.length ? `  листы вне карты: ${act.unknownSheets.join(', ')}` : ''}`,
    );
  }

  console.log('\nПОРУЧЕНИЯ, выплаченные в месяце');
  for (const order of result.paymentOrders) {
    console.log(
      `  ${order.paidOn}  №${order.bankOrderId}  строк ${String(order.operationCount).padStart(5)}` +
        `  реестр ${rub(order.registryKopecks).padStart(16)}  поручение ${rub(order.documentKopecks).padStart(16)}` +
        `  ${order.status}${order.reason ? `  ${order.reason}` : ''}`,
    );
  }

  console.log(
    `\nБЕЗ НОМЕРА ЗАКАЗА: ${result.storeLevel.count} строк на ${rub(result.storeLevel.totalKopecks)}`,
  );
  for (const row of result.storeLevel.items.slice(0, limit)) {
    console.log(
      `  ${row.accruedOn}  ${rub(row.amountKopecks).padStart(14)}  ${row.source === 'manual' ? 'ручная ' : ''}` +
        `${row.subArticle ?? row.article}  ${row.serviceName ?? ''}`,
    );
  }
  console.log(`\nКандидатов расхождений: ${result.candidateCount}`);
}

const sumOf = (values: readonly (number | null)[]) =>
  values.reduce<number>((s, v) => s + (v ?? 0), 0);

function printOrders(orders: readonly IComputedOrder[], limit: number): void {
  const known = orders.filter((o) => o.profit.netKopecks !== null);
  const byState = new Map<string, number>();
  for (const o of orders) {
    const title = ORDER_PROFIT_STATE_TITLE[o.profit.state];
    byState.set(title, (byState.get(title) ?? 0) + 1);
  }
  console.log(
    `\nЗАКАЗЫ: ${orders.length}  (${[...byState].map(([t, n]) => `${t} ${n}`).join(', ') || '—'})`,
  );
  console.log(
    `  прибыль известна у ${known.length}: ${rub(sumOf(known.map((o) => o.profit.netKopecks)))}` +
      `   подтверждено ${rub(sumOf(known.map((o) => o.profit.confirmedKopecks)))}` +
      `   ожидается ${rub(sumOf(known.map((o) => o.profit.expectedKopecks)))}`,
  );
  const unknown = orders.filter((o) => o.profit.netKopecks === null);
  if (unknown.length) {
    const reasons = new Map<string, number>();
    for (const o of unknown) {
      const why = o.profit.unknown
        ? `${ORDER_RESULT_TITLE[o.profit.unknown.key]}: ${o.profit.unknown.reason ?? '—'}`
        : '—';
      reasons.set(why, (reasons.get(why) ?? 0) + 1);
    }
    console.log(`  прибыль неизвестна у ${unknown.length} (null, не 0):`);
    for (const [why, n] of reasons) console.log(`      ${String(n).padStart(5)}  ${why}`);
  }

  for (const o of orders.slice(0, limit)) {
    const net = o.profit.netKopecks;
    console.log(
      `\n  № ${o.orderId}  ${ORDER_PROFIT_STATE_TITLE[o.profit.state]}  прибыль ${rub(net)}` +
        (o.profit.reconcile ? `  сверка ${o.profit.reconcile}` : ''),
    );
    for (const a of o.result.amounts) {
      if (a.kopecks === 0 && a.source !== 'unknown') continue;
      console.log(
        `      ${a.title.padEnd(28)} ${rub(a.kopecks).padStart(14)}  ${a.source}` +
          `${a.reason ? ` (${a.reason})` : ''}  операций ${a.operationIds.length}`,
      );
    }
  }
}

function printReturns(orders: readonly IComputedOrder[], limit: number): void {
  const returns = orders
    .filter((o) => o.lines.some(isReturnedOrderLine))
    // Тем же входом, что раздел «Возвраты» CRM (TASK-225): с повторной упаковкой заказа.
    .map(returnOfOrder);
  const known = returns.filter((r) => r.resultKopecks !== null);
  console.log(
    `\nВОЗВРАТЫ: ${returns.length}  результат известен у ${known.length}: ` +
      `${rub(sumOf(known.map((r) => r.resultKopecks)))}` +
      `   логистика ${rub(sumOf(returns.map((r) => r.logisticsKopecks)))}`,
  );
  for (const r of returns.slice(0, limit)) {
    console.log(
      `\n  № ${r.orderId}  результат ${rub(r.resultKopecks)}  логистика ${rub(r.logisticsKopecks)}` +
        (r.unknown
          ? `  неизвестно: ${RETURN_RESULT_TITLE[r.unknown.key]} (${r.unknown.reason ?? '—'})`
          : ''),
    );
    for (const a of r.amounts) {
      if (!a.kopecks) continue;
      console.log(
        `      ${a.title.padEnd(28)} ${rub(a.kopecks).padStart(14)}  операций ${a.operationIds.length}`,
      );
    }
  }
}

/** Карточка заказа без записи снимка: «что было бы записано», голова таблицы не трогается. */
const readOnlySnapshots = {
  recordSnapshot: async (): Promise<IOrderResultSnapshotWrite> => ({
    version: 0,
    written: false,
    reason: null,
  }),
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { user, period, marketplace, sections } = args;
  const context = await NestFactory.createApplicationContext(DiagnoseAccountingModule, {
    logger: ['error', 'warn'],
  });
  try {
    const reconcile = context.get(AccountingReconcileService);
    const now = new Date();
    console.log('─'.repeat(72));
    console.log(
      `  ПРОДАВЕЦ: ${user}   МЕСЯЦ: ${period.from}…${period.to}   ПЛОЩАДКА: ${marketplace}`,
    );
    console.log('─'.repeat(72));

    if (sections.has('orders') || sections.has('returns')) {
      const cards = new AccountingOrderCardService(
        context.get(AccountingService),
        context.get(AccountingOrderLineRepository),
        context.get(FinanceOperationRepository),
        context.get(AccountingManualOperationsService),
        context.get(AccountingStoreCostsService),
        context.get(AccountingTaxService),
        context.get(AccountingCogsService),
        reconcile,
        context.get(PriceCalcRatesService),
        readOnlySnapshots as never,
      );
      const store =
        marketplace === 'ym'
          ? await context.get(YandexMarketService).findByTelegramUser(user)
          : null;
      const orders = await cards.periodOrders(
        user,
        allFeaturesEnabled(),
        store,
        period,
        { marketplace },
        now,
      );
      if (sections.has('orders')) printOrders(orders, args.orders);
      if (sections.has('returns')) printReturns(orders, args.orders);
    }
    if (sections.has('reconcile')) {
      printReconcile(await reconcile.reconcile(user, period, now, marketplace), args.candidates);
    }
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
