/**
 * Журнал продавца для ИИ-аналитика на тестовой базе: сентябрь 2026, два заказа
 * артикула A1 (5000 и 7000 ₽), период сверен. Настоящие FinanceService и
 * инструменты (`AiToolsService`), Mongo-зависимости — заглушки.
 *
 * Без vitest-импортов: им пользуются и `__tests__/unit/ai-analyst.test.ts`, и
 * `scripts/eval-ai-analyst.ts --seed` (TASK-169).
 */

import type { TFinanceDb } from '../../src/database/postgres/finance-db';

import { FinanceAnomalyRepository } from '../../src/database/postgres/repositories/finance-anomaly.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from '../../src/database/postgres/repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { AiToolsService } from '../../src/modules/ai-tools/ai-tools.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceScreenService } from '../../src/modules/finance/finance-screen.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';

export const ANALYST_SELLER = '111';
export const ANALYST_SEPT = monthPeriod(2026, 9);
/** «Сегодня» засеянного журнала: сентябрь закрыт. */
export const ANALYST_NOW = new Date('2026-10-15T09:00:00Z');

const SEPT_KEY = financePeriodKey('united-netting', ANALYST_SEPT);
const noop = (): undefined => undefined;

export const nettingRow = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Часы',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.09.2026 14:05',
  actId: null,
  count: 2,
  transactionSum: 5000,
  paymentStatus: 'Переведён',
  bankOrderId: 'P1',
  bankOrderDate: '20.09.2026',
  bankSum: 5000,
  ...over,
});

/** Засеять журнал и собрать инструменты продавца `ANALYST_SELLER` поверх него. */
export async function seedAnalystTools(db: TFinanceDb): Promise<AiToolsService> {
  const operations = new FinanceOperationRepository(db);
  const documents = new FinanceDocumentRepository(db);
  const periods = new FinancePeriodRepository(db);
  const store = {
    telegramUserId: ANALYST_SELLER,
    commissionPercent: 23,
    taxPercent: 7,
    discountPercent: 0,
  };
  const engine = new FinanceService(
    operations,
    periods,
    new FinanceTaxService(new FinanceTaxSettingsRepository(db)),
    new FinanceExpensesService(new FinanceExpenseRepository(db)),
    { findByTelegramUser: async () => store } as never,
    {
      findBySkus: async (_user: string, skus: string[]) =>
        new Map(skus.filter((s) => s === 'A1').map((s) => [s, { price: 1500 }])),
    } as never,
    { findForSkus: async () => new Map() } as never,
    { build: noop } as never,
    { report: noop } as never,
  );
  const screen = new FinanceScreenService(
    operations,
    documents,
    periods,
    new FinanceDiscrepancyRepository(db),
    new FinanceCorrectionRepository(db),
    new FinanceAnomalyRepository(db),
  );
  // Инструменты экранов (прогноз, ДДС, налог, цена, расходы, остатки, возвраты) без своих сервисов:
  // закрытые фичами, они модели не видны; открытые — отвечают «Инструмент не ответил».
  const tools = new AiToolsService(
    engine,
    screen,
    { findByYmSkus: async () => [] } as never,
    { report: noop } as never,
    { build: noop } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  const { document } = await documents.registerVersion({
    marketplace: 'ym',
    telegramUserId: ANALYST_SELLER,
    businessId: 'b1',
    reportType: 'united-netting',
    periodFrom: ANALYST_SEPT.from,
    periodTo: ANALYST_SEPT.to,
    buffer: Buffer.from('v1'),
    filename: 'netting.zip',
    contentType: 'application/zip',
  });
  const rows = [nettingRow(), nettingRow({ orderId: 2, transactionSum: 7000, bankSum: 7000 })];
  const keys = journalKeys(rows);
  await operations.upsertMany(
    rows.map((r, i) =>
      nettingRowToOperation(r, keys[i], {
        telegramUserId: ANALYST_SELLER,
        businessId: 'b1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey: SEPT_KEY,
      }),
    ),
  );
  await periods.upsert({
    marketplace: 'ym',
    telegramUserId: ANALYST_SELLER,
    reportType: 'united-netting',
    periodKey: SEPT_KEY,
    periodFrom: ANALYST_SEPT.from,
    periodTo: ANALYST_SEPT.to,
    checkedAt: new Date(),
    status: 'verified',
    lastOutcome: 'imported',
    documentVersion: 1,
    unknownCount: 0,
    changedCount: 0,
    removedCount: 0,
    discrepancyCount: 0,
    reconcileState: 'checked',
    reconcileNote: null,
    error: null,
  });
  return tools;
}
