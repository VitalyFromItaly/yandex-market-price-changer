/**
 * Бэкфилл колонок реестра «Финучёта» (TASK-207) по уже записанным строкам
 * `finance_operations`: значения выводятся из сохранённого `raw` той же
 * `accountingColumnsOf`, что зовёт импорт, — импорт и бэкфилл дают одно и то же.
 *
 * Идемпотентен: строка обновляется, только если вычисленное отличается от
 * записанного, и второй прогон ничего не меняет. Записанное импортом не
 * ухудшается: пустое не стирает значение, а `unknown` не затирает узнанную
 * подстатью — у Ozon имена типов есть только у импорта (справочник), а в базе —
 * лишь в расшифровке многостатейных строк.
 *
 * Текущий P&L эти колонки не читает: бэкфилл его чисел не меняет по построению.
 */

import type { IAccountingRegistryColumns, TAccountingSubArticle } from './accounting-sub-articles';
import type { TFinanceExecutor } from '../../database/postgres/finance-db';
import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';

import { and, asc, eq, gt, type SQL } from 'drizzle-orm';

import { financeOperations as ops } from '../../database/postgres/finance.schema';
import { breakdownOf } from '../finance/operation-breakdown';

import { accountingColumnsOf } from './accounting-sub-articles';

const PAGE_SIZE = 1000;

export interface IRegistryBackfillOptions {
  telegramUserId?: string;
  marketplace?: TFinanceMarketplace;
  /** false — dry run: только считает, ничего не пишет. */
  apply: boolean;
}

export interface IRegistryBackfillReport {
  /** Строк просмотрено. */
  scanned: number;
  /** Строк, у которых вычисленное отличается от записанного (при apply — обновлено). */
  changed: number;
  /** Подстатьи после бэкфилла: площадка → подстатья → строк. */
  distribution: Record<string, Partial<Record<TAccountingSubArticle, number>>>;
}

type TStored = {
  [K in keyof IAccountingRegistryColumns]: IAccountingRegistryColumns[K] | null;
};

const sameMoment = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Вычисленное поверх записанного: пустое и `unknown` не стирают записанное. */
export function mergeRegistryColumns(
  stored: TStored,
  computed: IAccountingRegistryColumns,
): IAccountingRegistryColumns {
  return {
    subArticle:
      computed.subArticle === 'unknown' && stored.subArticle
        ? stored.subArticle
        : computed.subArticle,
    currency: computed.currency ?? stored.currency,
    itemId: computed.itemId ?? stored.itemId,
    reportedAt: computed.reportedAt ?? stored.reportedAt,
    processingStatus: computed.processingStatus ?? stored.processingStatus,
  };
}

export function registryColumnsDiffer(a: TStored, b: IAccountingRegistryColumns): boolean {
  return (
    a.subArticle !== b.subArticle ||
    a.currency !== b.currency ||
    a.itemId !== b.itemId ||
    !sameMoment(a.reportedAt, b.reportedAt) ||
    a.processingStatus !== b.processingStatus
  );
}

export async function backfillAccountingRegistry(
  db: TFinanceExecutor,
  options: IRegistryBackfillOptions,
): Promise<IRegistryBackfillReport> {
  const report: IRegistryBackfillReport = { scanned: 0, changed: 0, distribution: {} };
  const scope: SQL[] = [];
  if (options.telegramUserId) scope.push(eq(ops.telegramUserId, options.telegramUserId));
  if (options.marketplace) scope.push(eq(ops.marketplace, options.marketplace));

  let after: string | null = null;
  for (;;) {
    const filter = and(...scope, ...(after ? [gt(ops.id, after)] : []));
    const page = await db
      .select({
        id: ops.id,
        marketplace: ops.marketplace,
        transactionType: ops.transactionType,
        transactionSource: ops.transactionSource,
        serviceName: ops.serviceName,
        raw: ops.raw,
        breakdown: ops.breakdown,
        subArticle: ops.subArticle,
        currency: ops.currency,
        itemId: ops.itemId,
        reportedAt: ops.reportedAt,
        processingStatus: ops.processingStatus,
      })
      .from(ops)
      .where(filter)
      .orderBy(asc(ops.id))
      .limit(PAGE_SIZE);
    if (!page.length) break;

    for (const row of page) {
      report.scanned += 1;
      const computed = accountingColumnsOf({
        marketplace: row.marketplace,
        transactionType: row.transactionType,
        transactionSource: row.transactionSource,
        serviceName: row.serviceName,
        raw: row.raw,
        parts: breakdownOf(row.breakdown),
      });
      const next = mergeRegistryColumns(row, computed);
      const byMarketplace = (report.distribution[row.marketplace] ??= {});
      byMarketplace[next.subArticle] = (byMarketplace[next.subArticle] ?? 0) + 1;

      if (!registryColumnsDiffer(row, next)) continue;
      report.changed += 1;
      if (options.apply) {
        await db
          .update(ops)
          .set({
            subArticle: next.subArticle,
            currency: next.currency,
            itemId: next.itemId,
            reportedAt: next.reportedAt,
            processingStatus: next.processingStatus,
          })
          .where(eq(ops.id, row.id));
      }
    }
    after = page[page.length - 1].id;
  }
  return report;
}
