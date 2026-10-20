import type { ICrmPnlView } from '../../src/modules/crm/finance/crm-finance.domain';
import type { ICrmUnitEconomics } from '../../src/modules/crm/unit-economics/crm-unit-economics.domain';
import type { IPnlSku } from '../../src/modules/finance/pnl-sku';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { CRM_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import { CrmFinanceKinds } from '../../src/modules/crm/finance/crm-finance.kinds';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import {
  UNIT_ECONOMICS_KIND,
  minPriceOf,
} from '../../src/modules/crm/unit-economics/crm-unit-economics.domain';
import { CrmUnitEconomicsKinds } from '../../src/modules/crm/unit-economics/crm-unit-economics.kinds';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { FEATURE, FEATURE_META } from '../../src/modules/telegram/bots/shared/features.domain';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «Unit-экономика» CRM (TASK-138): разрез того же P&L, что «Финансы», поэтому
 * Σ прибыли товаров + «не относится к товару» сверяется с `finance:pnl` до копейки.
 */

const SELLER = '222';
const SEPT = monthPeriod(2026, 9);
const AUG = monthPeriod(2026, 8);
const OCT_15 = new Date('2026-10-15T09:00:00Z');

const row = (over: Record<string, unknown> = {}) => ({
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
  model: 'FBS',
  ...over,
});

const service = (orderId: number | null, name: string, sum: number) =>
  row({
    orderId,
    shopSku: null,
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    offerOrServiceName: name,
    transactionSum: sum,
    count: null,
    actDate: '30.09.2026',
    paymentStatus: null,
    bankOrderId: null,
    bankOrderDate: null,
    bankSum: null,
  });

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let finance: FinanceService;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  finance = new FinanceService(
    operations,
    new FinancePeriodRepository(pg.db),
    new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db)),
    new FinanceExpensesService(new FinanceExpenseRepository(pg.db)),
    { findByTelegramUser: async () => null } as never,
    // Закуп есть только у A1: у B2 себестоимость не подтверждена.
    { findBySkus: async () => new Map([['A1', { price: 1500 }]]) } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
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

const contextOf = (params: Record<string, unknown>) =>
  ({ telegramUserId: SELLER, store: {} as never, params, features: {} }) as const;

function kinds(names: Array<{ marketplaceSkus: { ym: string }; name: string }> = []) {
  return new CrmUnitEconomicsKinds({ register: vi.fn() } as never, finance, {
    findByYmSkus: async () => names,
  } as never);
}

const SEPT_PARAMS = { from: SEPT.from, to: SEPT.to, prevFrom: AUG.from, prevTo: AUG.to };

describe('«Unit-экономика» = «Финансам» по построению', () => {
  it('Σ прибыли товаров + «не относится к товару» = чистая finance:pnl до копейки', async () => {
    await seed([
      row(),
      row({ orderId: 2, shopSku: 'B2', count: 1, transactionSum: 2500.33 }),
      service(1, 'Размещение товарных предложений', -1150.17),
      service(2, 'Доставка покупателю', -200),
      service(null, 'Подписка', -169.9),
    ]);
    await seed(
      [row({ orderId: 7, transactionDate: '10.08.2026 10:00', transactionSum: 3000 })],
      AUG,
    );

    const pnl = await new CrmFinanceKinds({ register: vi.fn() } as never, finance).run(
      contextOf({ month: '2026-09' }),
      OCT_15,
    );
    const { data } = await kinds([{ marketplaceSkus: { ym: 'A1' }, name: 'Часы Casio' }]).skus(
      contextOf(SEPT_PARAMS),
      OCT_15,
    );
    const view = data as ICrmUnitEconomics;
    const net = (pnl.data as ICrmPnlView).levels.netKopecks;

    const sum = view.skus.reduce((s, sku) => s + sku.netKopecks, 0) + view.rest.netKopecks;
    expect(view.netKopecks).toBe(net);
    expect(sum).toBe(net);

    const a1 = view.skus.find((s) => s.sku === 'A1');
    const b2 = view.skus.find((s) => s.sku === 'B2');
    expect(a1).toMatchObject({
      name: 'Часы Casio',
      units: 2,
      orders: 1,
      costKnown: true,
      scheme: 'FBS',
    });
    expect(a1?.columns.commission).toBe(-115_017);
    expect(a1?.cogsKopecks).toBe(2 * 150_000 * 0.9);
    expect(a1?.previous).toMatchObject({ revenueKopecks: 300_000, units: 2 });
    expect(b2).toMatchObject({
      name: null,
      costKnown: false,
      minPriceKopecks: null,
      previous: null,
    });
    expect(b2?.columns.logistics).toBe(-20_000);
    // Подписка без заказа не делится по товарам — вся в «не относится к товару».
    expect(Object.values(view.rest.columns).reduce((a, b) => a + b, 0)).toBe(-16_990);
    expect(view.rest.lines).toBe(1);
    expect(view.period).toEqual(SEPT);
    expect(view.previousPeriod).toEqual(AUG);
  });

  it('кривой период — понятный отказ продавцу, а не сбой', async () => {
    await expect(
      kinds().skus(contextOf({ from: '2026-09-30', to: '2026-09-01' })),
    ).rejects.toBeInstanceOf(CrmJobError);
  });

  it('kind требует и unit_economics, и finance; раздел аккаунта открыт фичей; фича выключена', () => {
    const register = vi.fn();
    new CrmUnitEconomicsKinds({ register } as never, finance, {} as never).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      UNIT_ECONOMICS_KIND,
      expect.objectContaining({
        features: [FEATURE.UNIT_ECONOMICS, FEATURE.FINANCE],
        scope: 'account',
      }),
    );
    expect(CRM_SECTIONS['ym-unit-economics']).toEqual([FEATURE.UNIT_ECONOMICS]);
    expect(FEATURE_META[FEATURE.UNIT_ECONOMICS].defaultEnabled).toBe(false);
  });
});

describe('минимальная цена (прибыль = 0)', () => {
  const sku = (over: Partial<IPnlSku> = {}): IPnlSku => ({
    sku: 'A1',
    scheme: 'FBS',
    columns: {
      revenue: 1_000_000,
      otherIncome: 0,
      commission: -200_000,
      logistics: -100_000,
      promotion: -50_000,
      otherServices: 0,
      unrecognized: 0,
    },
    cogsKopecks: 300_000,
    taxKopecks: 50_000,
    netKopecks: 300_000,
    units: 2,
    orders: 2,
    costKnown: true,
    schemes: [],
    ...over,
  });

  it('F / (1 − r): процентные — комиссия, продвижение, налог; на штуку — закуп и логистика', () => {
    // r = (200 000 + 50 000 + 50 000) / 1 000 000 = 0.3; F = (300 000 + 100 000) / 2 = 200 000.
    const price = minPriceOf(sku()) as number;
    expect(price).toBe(Math.round(200_000 / 0.7));
    // Проверка смыслом: по этой цене прибыль штуки ≈ 0.
    expect(price - price * 0.3 - 200_000).toBeCloseTo(0, -1);
  });

  it('не считается без штук, без выручки, без подтверждённого закупа и при r ≥ 1', () => {
    expect(minPriceOf(sku({ units: 0 }))).toBeNull();
    expect(minPriceOf(sku({ costKnown: false }))).toBeNull();
    expect(minPriceOf(sku({ columns: { ...sku().columns, revenue: 0 } }))).toBeNull();
    expect(minPriceOf(sku({ columns: { ...sku().columns, commission: -1_000_000 } }))).toBeNull();
  });
});
