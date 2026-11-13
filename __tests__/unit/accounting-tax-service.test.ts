import type { ITestFinanceDb } from '../helpers/test-postgres';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountingManualOperationRepository } from '../../src/database/postgres/repositories/accounting-manual-operation.repository';
import { AccountingTaxSettingsRepository } from '../../src/database/postgres/repositories/accounting-tax-settings.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { FinanceTaxYearRepository } from '../../src/database/postgres/repositories/finance-tax-year.repository';
import { AccountingManualOperationsService } from '../../src/modules/accounting/accounting-manual-operations.service';
import {
  AccountingTaxSettingsService,
  TaxBaseRuleValidationError,
} from '../../src/modules/accounting/accounting-tax-settings.service';
import { AccountingTaxService } from '../../src/modules/accounting/accounting-tax.service';
import {
  ACCOUNTING_TAX_YEAR_KIND,
  toCrmAccountingTaxYear,
} from '../../src/modules/crm/accounting/crm-accounting.domain';
import { CrmAccountingKinds } from '../../src/modules/crm/accounting/crm-accounting.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceTaxYearDataService } from '../../src/modules/finance/finance-tax-year-data.service';
import { FinanceTaxYearService } from '../../src/modules/finance/finance-tax-year.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Налог «Финучёта» (TASK-221) на PGlite: журнал + ручные операции → год по
 * отчётным периодам; валовая база на журнале ЯМ совпадает с налогом «Налогов»,
 * правило базы — настройка продавца.
 */

const SELLER = '222';
const SEPT = monthPeriod(2026, 9);
const OCT_15 = new Date('2026-10-15T09:00:00Z');

const row = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Часы',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.09.2026 14:05',
  actId: null,
  count: 1,
  transactionSum: 10000,
  paymentStatus: 'Переведён',
  bankOrderId: 'P1',
  bankOrderDate: '20.09.2026',
  bankSum: 7700,
  model: 'FBS',
  ...over,
});

const commission = row({
  shopSku: null,
  transactionType: 'Удержание',
  transactionSource: 'Оплата услуг Маркета',
  offerOrServiceName: 'Размещение товарных предложений',
  transactionSum: -2300,
  count: null,
  actDate: '30.09.2026',
});

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let taxes: FinanceTaxService;
let manual: AccountingManualOperationsService;
let baseRules: AccountingTaxSettingsService;
let current: FinanceTaxYearService;
let service: AccountingTaxService;
const marketplacesOf = vi.fn(async () => ['ym']);

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  taxes = new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db));
  const data = new FinanceTaxYearDataService(new FinanceTaxYearRepository(pg.db));
  const expenses = new FinanceExpensesService(new FinanceExpenseRepository(pg.db));
  const purchases = new FinancePurchaseRepository(pg.db);
  manual = new AccountingManualOperationsService(new AccountingManualOperationRepository(pg.db));
  baseRules = new AccountingTaxSettingsService(new AccountingTaxSettingsRepository(pg.db));
  const finance = new FinanceService(
    operations,
    new FinancePeriodRepository(pg.db),
    taxes,
    expenses,
    { findByTelegramUser: async () => null } as never,
    { findBySkus: async () => new Map([['A1', { price: 5000 }]]) } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
  current = new FinanceTaxYearService(finance, taxes, data, purchases);
  service = new AccountingTaxService(
    { marketplacesOf } as never,
    operations,
    manual,
    taxes,
    data,
    purchases,
    expenses,
    {
      cogsOf: async () => ({ kopecks: 0, unknown: { count: 0, operationIds: [] } }),
      lotCostOf: async () => undefined,
    } as never,
    baseRules,
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.reset();
  marketplacesOf.mockClear();
});

async function seed(rows: Record<string, unknown>[], period = SEPT) {
  const { document } = await documents.registerVersion({
    marketplace: 'ym',
    telegramUserId: SELLER,
    businessId: 'b1',
    reportType: 'united-netting',
    periodFrom: period.from,
    periodTo: period.to,
    buffer: Buffer.from(JSON.stringify(rows)),
    filename: 'netting.zip',
    contentType: 'application/zip',
  });
  const keys = journalKeys(rows);
  await operations.upsertMany(
    rows.map((r, i) =>
      nettingRowToOperation(r, keys[i], {
        telegramUserId: SELLER,
        businessId: 'b1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey: financePeriodKey('united-netting', period),
      }),
    ),
  );
}

const ACTOR = { author: SELLER, impersonatedBy: null };

describe('AccountingTaxService', () => {
  it('валовая база на журнале ЯМ — те же доход и налог периодов, что у «Налогов»', async () => {
    await seed([row(), commission]);
    const ours = await service.year(SELLER, {}, 2026, OCT_15);
    const theirs = await current.build(SELLER, 2026, OCT_15);

    expect(ours.taxYear.periods.map((p) => [p.key, p.incomeKopecks, p.taxKopecks])).toEqual(
      theirs.taxYear.periods.map((p) => [p.key, p.incomeKopecks, p.taxKopecks]),
    );
    expect(ours.baseRule).toMatchObject({ rule: 'gross', isDefault: true });
    const m9 = ours.periods.find((p) => p.key === 'm9');
    expect(m9?.accounting.composition.map((c) => [c.component, c.kopecks])).toEqual([
      ['sales', 1_000_000],
    ]);
  });

  it('ручная операция дохода — корректировка базы; нетто вычитает комиссию', async () => {
    await seed([row(), commission]);
    await manual.create(
      SELLER,
      {
        clientKey: randomUUID(),
        marketplace: 'ym',
        article: 'other_income',
        amount: '500',
        accruedOn: '2026-09-25',
        source: 'Акт сверки',
      },
      ACTOR,
    );
    const gross = await service.year(SELLER, {}, 2026, OCT_15);
    const m9 = gross.periods.find((p) => p.key === 'm9');
    expect(m9?.accounting.tax.incomeKopecks).toBe(1_050_000);
    expect(m9?.accounting.composition.find((c) => c.component === 'corrections')?.kopecks).toBe(
      50_000,
    );

    await baseRules.set(SELLER, 'net');
    const net = await service.year(SELLER, {}, 2026, OCT_15);
    const netM9 = net.periods.find((p) => p.key === 'm9');
    expect(netM9?.accounting.tax.incomeKopecks).toBe(1_050_000 - 230_000);
    expect(net.baseRule).toMatchObject({ rule: 'net', isDefault: false });
  });

  it('уплаченный налог и остаток — из уплат продавца', async () => {
    await seed([row()]);
    await new FinancePurchaseRepository(pg.db).createTaxPayment(SELLER, {
      paidDay: '2026-10-05',
      amountKopecks: 40_000,
      note: null,
    });
    const { taxYear } = await service.year(SELLER, {}, 2026, OCT_15);
    expect(taxYear.paidKopecks).toBe(40_000);
    expect(taxYear.balanceKopecks).toBe(60_000 - 40_000);
  });

  it('налог на заказ — общий расход kind tax на сумму налога периода', async () => {
    await seed([row()]);
    const item = await service.orderTaxItem(SELLER, {}, SEPT);
    expect(item).toMatchObject({ kind: 'tax', kopecks: -60_000, source: 'tax' });
  });

  it('правило базы: без строки — валовая, чужое значение — ошибка и прежнее правило', async () => {
    expect(await baseRules.snapshot(SELLER)).toMatchObject({ rule: 'gross', isDefault: true });
    await baseRules.set(SELLER, 'net');
    await expect(baseRules.set(SELLER, 'half')).rejects.toBeInstanceOf(TaxBaseRuleValidationError);
    expect(await baseRules.snapshot(SELLER)).toMatchObject({ rule: 'net', isDefault: false });
  });

  it('kind года — под зонтиком «Финучёта», чужой год — ошибка задачи, ответ без строк базы', async () => {
    await seed([row()]);
    const register = vi.fn();
    const kinds = new CrmAccountingKinds(
      { register } as never,
      service,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    kinds.onModuleInit();
    expect(register).toHaveBeenCalledWith(
      ACCOUNTING_TAX_YEAR_KIND,
      expect.objectContaining({ features: [FEATURE.FIN_ACCOUNTING], scope: 'account' }),
    );

    const context = { jobId: 'j', telegramUserId: SELLER, store: null, features: {} };
    await expect(
      kinds.taxYear({ ...context, params: { year: 1999 } }, OCT_15),
    ).rejects.toBeInstanceOf(CrmJobError);
    const { data } = await kinds.taxYear({ ...context, params: { year: 2026 } }, OCT_15);
    const view = data as ReturnType<typeof toCrmAccountingTaxYear>;
    expect(view.baseRule.options.map((o) => o.key)).toEqual(['gross', 'net']);
    expect(view.basis.find((b) => b.period === 'm9')?.composition[0].kopecks).toBe(1_000_000);
    expect(view.orderTaxNote).toBe('Оценка, не обязательство');
    expect(marketplacesOf).toHaveBeenCalled();
  });
});
