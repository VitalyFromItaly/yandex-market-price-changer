import type {
  ICrmPriceCalcRates,
  ICrmPriceCalcTariff,
} from '../../src/modules/crm/price-calculator/crm-price-calc.domain';
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
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import {
  PRICE_CALC_RATES_KIND,
  PRICE_CALC_TARIFF_KIND,
} from '../../src/modules/crm/price-calculator/crm-price-calc.domain';
import { CrmPriceCalcKinds } from '../../src/modules/crm/price-calculator/crm-price-calc.kinds';
import { CrmUnitEconomicsKinds } from '../../src/modules/crm/unit-economics/crm-unit-economics.kinds';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { calcSkuOf, calcTaxOf, priceCalcWindow } from '../../src/modules/finance/price-calc-rates';
import { PriceCalcRatesService } from '../../src/modules/finance/price-calc-rates.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { FEATURE, FEATURE_META } from '../../src/modules/telegram/bots/shared/features.domain';
import { TariffQuoteService } from '../../src/modules/yandex/reports/tariff-quote.service';
import { priceFor, profitAt } from '../../src/shared/price-calc';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * «Калькулятор цен» CRM (TASK-139): ставки — тот же разрез `pnl.skus`, что
 * unit-экономика, поэтому доли сверяются с её `shares` за то же окно.
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

const contextOf = (params: Record<string, unknown> = {}, store: unknown = {}) =>
  ({ telegramUserId: SELLER, store: store as never, params, features: {} }) as const;

const NAMES = [{ marketplaceSkus: { ym: 'A1' }, name: 'Часы Casio' }];

function kinds(tariffs: unknown = {}) {
  return new CrmPriceCalcKinds(
    { register: vi.fn() } as never,
    new PriceCalcRatesService(
      finance,
      new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db)),
      { findByYmSkus: async () => NAMES } as never,
      { findBySkus: async () => new Map([['A1', { price: 1500 }]]) } as never,
    ),
    tariffs as never,
  );
}

async function seedWindow() {
  await seed([
    row(),
    row({ orderId: 2, shopSku: 'B2', count: 1, transactionSum: 2500.33 }),
    service(1, 'Размещение товарных предложений', -1150.17),
    service(2, 'Доставка покупателю', -200),
    service(null, 'Подписка', -169.9),
  ]);
}

describe('ставки калькулятора из журнала', () => {
  it('окно — 30 дней по Москве, включая сегодня', () => {
    expect(priceCalcWindow(OCT_15)).toEqual({ from: '2026-09-16', to: '2026-10-15' });
  });

  it('доли и рубли на штуку = unit-экономике за то же окно; источник виден', async () => {
    await seedWindow();
    const { data } = await kinds().rates(contextOf(), OCT_15);
    const view = data as ICrmPriceCalcRates;

    const window = priceCalcWindow(OCT_15);
    const unit = (
      await new CrmUnitEconomicsKinds({ register: vi.fn() } as never, finance, {
        findByJournalSkus: async () => new Map(NAMES.map((p) => [p.marketplaceSkus.ym, p])),
      } as never).skus(
        contextOf({
          from: window.from,
          to: window.to,
          prevFrom: '2026-08-01',
          prevTo: '2026-08-30',
        }),
        OCT_15,
      )
    ).data as ICrmUnitEconomics;

    const a1 = view.skus.find((s) => s.sku === 'A1');
    const unitA1 = unit.skus.find((s) => s.sku === 'A1');
    expect(a1).toMatchObject({
      name: 'Часы Casio',
      units: 2,
      avgPriceKopecks: 250_000,
      ratesSource: 'fact_sku',
      // Закуп из прайса минус скидка 10 % по умолчанию — тем же, чем считает «Прибыль».
      cogsKopecks: 135_000,
      cogsSource: 'price_list',
    });
    expect(a1?.rates?.commissionRate).toBeCloseTo(unitA1?.shares.commission as number, 12);

    const b2 = view.skus.find((s) => s.sku === 'B2');
    expect(b2).toMatchObject({ cogsKopecks: null, cogsSource: 'no_data' });
    expect(b2?.rates?.logisticsKopecks).toBe(20_000);

    expect(view.window).toEqual(window);
    expect(view.tax).toMatchObject({ mode: 'revenue', rate: 0.06, source: 'tax_default' });
    expect(view.sourceLabels.fact_sku).toBe('факт товара за 30 дней');
    expect(view.sourceLabels.tariff).toBe('тариф ЯМ');
  });

  it('ставки товара в формуле: прямой и обратный расчёт сходятся', async () => {
    await seedWindow();
    const view = (await kinds().rates(contextOf(), OCT_15)).data as ICrmPriceCalcRates;
    const a1 = view.skus.find((s) => s.sku === 'A1');
    if (!a1?.rates || a1.cogsKopecks === null) throw new Error('нет ставок A1');
    const input = {
      discountRate: 0,
      ...a1.rates,
      cogsKopecks: a1.cogsKopecks,
      tax: view.tax,
    };
    const solution = priceFor({ kind: 'margin', rate: 0.2 }, input);
    if (!solution.ok) throw new Error(solution.reason);
    expect(profitAt(solution.priceKopecks, input).margin as number).toBeCloseTo(0.2, 4);
  });

  it('товар без своих продаж — средние по всем товарам, с меткой', () => {
    const account = {
      commissionRate: 0.2,
      promotionRate: 0,
      logisticsKopecks: 100,
      otherKopecks: 0,
    };
    const sku = {
      sku: 'Z',
      units: 0,
      costKnown: true,
      cogsKopecks: 0,
      columns: {
        revenue: 0,
        otherIncome: 0,
        commission: -500,
        logistics: 0,
        promotion: 0,
        otherServices: 0,
        unrecognized: 0,
      },
    } as IPnlSku;
    expect(calcSkuOf(sku, account, null, undefined)).toMatchObject({
      rates: account,
      ratesSource: 'fact_account',
      avgPriceKopecks: null,
      cogsSource: 'no_data',
    });
    expect(calcSkuOf(sku, null, null, 9_900)).toMatchObject({
      rates: null,
      ratesSource: 'no_data',
      cogsKopecks: 9_900,
      cogsSource: 'price_list',
    });
  });

  it('«Доходы минус расходы» — режим profit и минимальный налог 1 %', () => {
    expect(
      calcTaxOf(
        { regime: 'usn_income_minus_expenses', rateBasisPoints: 1500, recognition: 'payment' },
        false,
      ),
    ).toMatchObject({ mode: 'profit', rate: 0.15, minRate: 0.01, source: 'tax_settings' });
  });
});

describe('сверка с тарифом ЯМ', () => {
  const STORE = { token: 't', campaign_id: '1', business_id: '2', telegramUserId: SELLER };

  function quoteService(found: boolean) {
    const calculateTariffs = vi.fn(async (offers: Array<{ price: number }>) => [
      {
        offer: offers[0],
        tariffs: [
          { type: 'FEE', amount: 460 },
          { type: 'AGENCY_COMMISSION', amount: 40 },
          { type: 'DELIVERY_TO_CUSTOMER', amount: 150 },
          { type: 'SORTING', amount: 25.5 },
        ],
      },
    ]);
    const client = {
      getOfferMappings: async () =>
        new Map(found ? [['A1', { offerId: 'A1', marketCategoryId: 91491 }]] : []),
      calculateTariffs,
    };
    return {
      service: new TariffQuoteService({ forStore: () => client } as never),
      calculateTariffs,
    };
  }

  it('процентные услуги → ставка комиссии, остальное → логистика на штуку', async () => {
    const { service, calculateTariffs } = quoteService(true);
    const { data } = await kinds(service).tariff(
      contextOf({ sku: 'A1', priceKopecks: 200_000 }, STORE),
    );
    const quote = data as ICrmPriceCalcTariff;
    // Цена в калькулятор Маркета уходит рублями, габариты — фолбэк часов.
    expect(calculateTariffs.mock.calls[0][0][0]).toMatchObject({
      price: 2000,
      length: 11,
      weight: 0.3,
    });
    expect(quote.sku).toBe('A1');
    expect(quote.commissionRate).toBeCloseTo(0.25, 12);
    expect(quote.logisticsKopecks).toBe(17_550);
    expect(quote.services.find((s) => s.type === 'FEE')).toMatchObject({
      label: 'Размещение на Маркете',
      kopecks: 46_000,
      percent: true,
    });
  });

  it('товара нет в каталоге — понятный отказ, а не сбой', async () => {
    const { service } = quoteService(false);
    await expect(
      kinds(service).tariff(contextOf({ sku: 'A1', priceKopecks: 200_000 }, STORE)),
    ).rejects.toBeInstanceOf(CrmJobError);
  });

  it('кривые параметры — отказ до запроса в Маркет', async () => {
    const { service, calculateTariffs } = quoteService(true);
    await expect(
      kinds(service).tariff(contextOf({ sku: 'A1', priceKopecks: -5 }, STORE)),
    ).rejects.toBeInstanceOf(CrmJobError);
    expect(calculateTariffs).not.toHaveBeenCalled();
  });
});

describe('регистрация функции', () => {
  it('ставки — аккаунта и с finance, тариф — магазина; раздел открыт фичей; фича выключена', () => {
    const register = vi.fn();
    new CrmPriceCalcKinds({ register } as never, {} as never, {} as never).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      PRICE_CALC_RATES_KIND,
      expect.objectContaining({
        features: [FEATURE.PRICE_CALCULATOR, FEATURE.FINANCE],
        scope: 'account',
      }),
    );
    const tariff = register.mock.calls.find(([kind]) => kind === PRICE_CALC_TARIFF_KIND)?.[1];
    expect(tariff).toMatchObject({ features: [FEATURE.PRICE_CALCULATOR] });
    expect(tariff.scope).toBeUndefined();
    expect(CRM_SECTIONS['ym-price-calculator']).toEqual([FEATURE.PRICE_CALCULATOR]);
    expect(FEATURE_META[FEATURE.PRICE_CALCULATOR].defaultEnabled).toBe(false);
  });
});
