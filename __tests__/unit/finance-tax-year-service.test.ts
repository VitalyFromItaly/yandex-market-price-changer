import type { ICrmTaxYear } from '../../src/modules/crm/taxes/crm-taxes.domain';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinancePurchaseRepository } from '../../src/database/postgres/repositories/finance-purchase.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { FinanceTaxYearRepository } from '../../src/database/postgres/repositories/finance-tax-year.repository';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { TAX_YEAR_KIND } from '../../src/modules/crm/taxes/crm-taxes.domain';
import { CrmTaxesKinds } from '../../src/modules/crm/taxes/crm-taxes.kinds';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceTaxYearDataService } from '../../src/modules/finance/finance-tax-year-data.service';
import { FinanceTaxYearService } from '../../src/modules/finance/finance-tax-year.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import {
  FEATURE,
  FEATURE_META,
  isFeatureEnabled,
} from '../../src/modules/telegram/bots/shared/features.domain';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Налоговый модуль ИП (TASK-146) на PGlite: доход и налог отчётного периода —
 * тот же `FinanceService.build`, что «Финансы» за этот период, а параметры
 * года — строка в базе, а не код.
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
  offerOrServiceName: 'Размещение товаров на витрине',
  transactionSum: -2300,
  count: null,
  actDate: '30.09.2026',
});

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let finance: FinanceService;
let taxes: FinanceTaxService;
let data: FinanceTaxYearDataService;
let years: FinanceTaxYearRepository;
let service: FinanceTaxYearService;
/** Строки лет сразу после миграций — до первого reset. */
let seededYears: number[];

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  taxes = new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db));
  years = new FinanceTaxYearRepository(pg.db);
  data = new FinanceTaxYearDataService(years);
  finance = new FinanceService(
    operations,
    new FinancePeriodRepository(pg.db),
    taxes,
    new FinanceExpensesService(new FinanceExpenseRepository(pg.db)),
    { findByTelegramUser: async () => null } as never,
    { findBySkus: async () => new Map([['A1', { price: 5000 }]]) } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
  service = new FinanceTaxYearService(finance, taxes, data, new FinancePurchaseRepository(pg.db));
  seededYears = (await years.listYears()).map((y) => y.year);
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.reset();
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

const PARAMS_2026 = {
  year: 2026,
  usnIncomeLimitKopecks: 49_050_000_000,
  vatThresholdKopecks: 2_000_000_000,
  insuranceFixedKopecks: 5_739_000,
  insuranceExtraCapKopecks: 32_181_800,
  reductionLimitWithStaffBasisPoints: 5000,
  maxRateUsnIncomeBasisPoints: 600,
  maxRateUsnIncomeMinusExpensesBasisPoints: 1500,
  sourceNote: 'тест',
};

describe('FinanceTaxYearService', () => {
  it('доход и налог 9 месяцев — ровно «Финансы» за тот же период; база — до комиссии', async () => {
    await seed([row(), commission]);
    const report = await service.build(SELLER, 2026, OCT_15);
    const m9 = report.taxYear.periods.find((p) => p.key === 'm9');
    const pnl = await finance.build(SELLER, { from: '2026-01-01', to: '2026-09-30' }, OCT_15, { flat: false });

    expect(report.taxYear.periods.map((p) => p.key)).toEqual(['q1', 'h1', 'm9', 'y']);
    expect(m9?.incomeKopecks).toBe(pnl.pnl.tax.incomeKopecks);
    expect(m9?.taxKopecks).toBe(pnl.pnl.tax.taxKopecks);
    // 10 000 ₽ продажи при 2 300 ₽ комиссии: 6 % от 10 000, а не от 7 700.
    expect(m9).toMatchObject({ incomeKopecks: 1_000_000, taxKopecks: 60_000, advanceKopecks: 60_000 });
    expect(report.taxYear.periods[0].incomeKopecks).toBe(0);
    expect(report.taxYear.forecast?.kind).toBe('forecast');
  });

  it('уменьшения и уплаты продавца входят, чужие — нет', async () => {
    await seed([row(), commission]);
    await data.createReduction(SELLER, { paidDay: '2026-07-10', kind: 'insurance_fixed', amount: '200' });
    await data.createReduction('333', { paidDay: '2026-07-10', kind: 'insurance_fixed', amount: '9999' });
    await new FinancePurchaseRepository(pg.db).createTaxPayment(SELLER, {
      paidDay: '2026-10-05',
      amountKopecks: 40_000,
      note: null,
    });
    const { taxYear } = await service.build(SELLER, 2026, OCT_15);
    const m9 = taxYear.periods.find((p) => p.key === 'm9');
    expect(m9).toMatchObject({ reductionsPaidKopecks: 20_000, reductionKopecks: 20_000, dueKopecks: 40_000 });
    expect(taxYear.paidKopecks).toBe(40_000);
    expect(taxYear.balanceKopecks).toBe(0);
  });

  it('миграция заводит параметры 2025–2027', () => {
    expect(seededYears).toEqual([2027, 2026, 2025]);
  });

  it('параметры года — строка в базе: правка порога меняет предупреждение без кода', async () => {
    await seed([row({ transactionSum: 9_000_000, bankSum: 9_000_000 })]);
    const none = await service.build(SELLER, 2026, OCT_15);
    expect(none.params).toBeNull();
    expect(none.taxYear.warnings.map((w) => w.key)).toContain('params_missing');

    await years.upsertYear(PARAMS_2026);
    const loose = await service.build(SELLER, 2026, OCT_15);
    expect(loose.taxYear.warnings.map((w) => w.key)).not.toContain('vat_exceeded');

    // Админ вводит рубли и проценты — как в форме, а не копейки.
    await data.saveParams(2026, {
      usnIncomeLimitKopecks: '490 500 000',
      vatThresholdKopecks: '8 000 000',
      reductionLimitWithStaffBasisPoints: '50',
    });
    const strict = await service.build(SELLER, 2026, OCT_15);
    expect(strict.params?.vatThresholdKopecks).toBe(800_000_000);
    expect(strict.taxYear.warnings.map((w) => w.key)).toContain('vat_exceeded');
  });

  it('сверка: повторная отметка не сдвигает момент, снятие обнуляет', async () => {
    await data.saveReconciliation(SELLER, 2026, 'q1', { checked: true, accountantIncome: '0' });
    const [first] = await data.reconciliations(SELLER, 2026);
    await data.saveReconciliation(SELLER, 2026, 'q1', { checked: true, note: 'ещё раз' });
    const [second] = await data.reconciliations(SELLER, 2026);
    expect(second.checkedAt?.getTime()).toBe(first.checkedAt?.getTime());
    expect(second.accountantIncomeKopecks).toBeNull();
    await data.saveReconciliation(SELLER, 2026, 'q1', { checked: false });
    const [third] = await data.reconciliations(SELLER, 2026);
    expect(third.checkedAt).toBeNull();
  });
});

describe('kind taxes:year', () => {
  const kinds = () => new CrmTaxesKinds({ register: vi.fn() } as never, service);
  const contextOf = (params: Record<string, unknown>) =>
    ({ telegramUserId: SELLER, store: {} as never, params, features: {} }) as never;

  it('регистрируется уровнем аккаунта под фичей tax_year', () => {
    const register = vi.fn();
    new CrmTaxesKinds({ register } as never, service).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      TAX_YEAR_KIND,
      expect.objectContaining({ features: [FEATURE.TAX_YEAR], scope: 'account' }),
    );
  });

  it('год вне диапазона — понятный отказ, не алерт', async () => {
    for (const year of [2019, 2027, 'abc', undefined]) {
      await expect(kinds().year(contextOf({ year }), OCT_15)).rejects.toBeInstanceOf(CrmJobError);
    }
  });

  it('вид — перечисление полей, без id продавца; прогноз помечен', async () => {
    await seed([row(), commission]);
    await years.upsertYear(PARAMS_2026);
    const { data: view } = (await kinds().year(contextOf({ year: 2026 }), OCT_15)) as { data: ICrmTaxYear };
    expect(view.year).toBe(2026);
    expect(view.reductionsApply).toBe(true);
    expect(view.periods.map((p) => p.label)).toEqual(['I квартал', 'Полугодие', '9 месяцев', 'Год']);
    expect(view.limits.map((l) => l.valueKopecks)).toEqual([49_050_000_000, 2_000_000_000]);
    expect(view.forecast).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain(SELLER);
  });
});

describe('фича tax_year', () => {
  it('выключена по умолчанию и требует taxes и finance', () => {
    expect(FEATURE_META[FEATURE.TAX_YEAR].defaultEnabled).toBe(false);
    expect(isFeatureEnabled({ [FEATURE.TAX_YEAR]: true }, FEATURE.TAX_YEAR)).toBe(false);
    expect(
      isFeatureEnabled({ [FEATURE.TAX_YEAR]: true, [FEATURE.TAXES]: true }, FEATURE.TAX_YEAR),
    ).toBe(false);
    expect(
      isFeatureEnabled(
        { [FEATURE.TAX_YEAR]: true, [FEATURE.TAXES]: true, [FEATURE.FINANCE]: true },
        FEATURE.TAX_YEAR,
      ),
    ).toBe(true);
  });
});
