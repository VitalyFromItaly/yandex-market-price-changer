import type {
  IAccountingTaxInput,
  ITaxJournalOperation,
  ITaxManualOperation,
} from '../../src/modules/accounting/accounting-tax';
import type { ITaxSettings } from '../../src/modules/finance/tax.domain';

import { describe, expect, it } from 'vitest';

import {
  accountingTaxOf,
  accountingTaxYearOf,
  orderTaxItemOf,
  TAX_BASE_ARTICLES_BY_RULE,
  taxBaseItemsOf,
  taxCogsOf,
} from '../../src/modules/accounting/accounting-tax';
import { ORDER_TAX_ESTIMATE_NOTE, orderResultOf } from '../../src/modules/accounting/order-result';
import { allocateStoreCosts } from '../../src/modules/accounting/store-cost-allocation';
import { TAX_BASE_ARTICLES } from '../../src/modules/finance/tax';
import { reportingPeriodsOf } from '../../src/modules/finance/tax-year';

/**
 * Налог нового учёта «Финучёта» (TASK-221): база по правилу агентской базы,
 * раскрытие до операций, вычеты v2, год поверх `taxYearOf`, оценка на заказ.
 */

const MARCH = { from: '2026-03-01', to: '2026-03-31' };

const USN_INCOME: ITaxSettings = {
  regime: 'usn_income',
  rateBasisPoints: 600,
  recognition: 'realization',
};
const USN_MINUS: ITaxSettings = {
  regime: 'usn_income_minus_expenses',
  rateBasisPoints: 1500,
  recognition: 'realization',
};

let seq = 0;
const op = (over: Partial<ITaxJournalOperation> = {}): ITaxJournalOperation => ({
  id: `j-${++seq}`,
  marketplace: 'ym',
  article: 'sales',
  subArticle: null,
  amountKopecks: 0,
  accruedDay: '2026-03-10',
  paidDay: '2026-03-15',
  ...over,
});

const manual = (over: Partial<ITaxManualOperation> = {}): ITaxManualOperation => ({
  id: `m-${++seq}`,
  marketplace: 'ym',
  article: 'other_income',
  subArticle: null,
  amountKopecks: 0,
  accruedOn: '2026-03-20',
  ...over,
});

/** Март: продажа, возврат, корректировка, компенсация, удержания, нераспознанное, баллы. */
const SALE = op({ id: 'sale', amountKopecks: 100_000 });
const RETURN = op({ id: 'return', article: 'returns', amountKopecks: -20_000 });
const CORRECTION = op({
  id: 'correction',
  article: 'sales',
  subArticle: 'sale_correction',
  amountKopecks: 5_000,
});
const COMPENSATION = op({ id: 'compensation', article: 'compensations', amountKopecks: 3_000 });
const COMMISSION = op({ id: 'commission', article: 'commission', amountKopecks: -15_000 });
const UNKNOWN = op({ id: 'unknown', article: 'unknown', amountKopecks: 700 });
const BONUS = op({ id: 'bonus', article: 'bonus_payment', amountKopecks: 1_000 });
const JOURNAL = [SALE, RETURN, CORRECTION, COMPENSATION, COMMISSION, UNKNOWN, BONUS];

const MANUAL_INCOME = manual({ id: 'manual-income', amountKopecks: 2_000 });
const MANUAL_EXPENSE = manual({
  id: 'manual-expense',
  article: 'other_services',
  amountKopecks: -1_000,
});
const MANUAL = [MANUAL_INCOME, MANUAL_EXPENSE];

const input = (over: Partial<IAccountingTaxInput> = {}): IAccountingTaxInput => ({
  settings: USN_INCOME,
  rule: 'gross',
  period: MARCH,
  journal: JOURNAL,
  manual: MANUAL,
  opexKopecks: 5_000,
  cogs: null,
  ...over,
});

const componentOf = (result: ReturnType<typeof accountingTaxOf>, key: string) =>
  result.composition.find((c) => c.component === key);

describe('налог «Финучёта» — база', () => {
  it('валовая: продажи, возвраты, корректировки, компенсации; удержания базу не уменьшают', () => {
    const result = accountingTaxOf(input());
    // 100 000 − 20 000 + (5 000 + 2 000) + 3 000
    expect(result.tax.incomeKopecks).toBe(90_000);
    expect(result.tax.taxKopecks).toBe(5_400);
    expect(result.composition.map((c) => [c.component, c.kopecks])).toEqual([
      ['sales', 100_000],
      ['returns', -20_000],
      ['corrections', 7_000],
      ['compensations', 3_000],
    ]);
    expect(result.ruleTitle).toMatch(/валовая/);
  });

  it('состав сходится с доходом и раскрыт до операций', () => {
    const result = accountingTaxOf(input());
    const total = result.composition.reduce((sum, c) => sum + c.kopecks, 0);
    expect(total).toBe(result.tax.incomeKopecks);
    expect(componentOf(result, 'sales')?.operationIds).toEqual(['sale']);
    expect(componentOf(result, 'returns')?.operationIds).toEqual(['return']);
    expect(componentOf(result, 'corrections')?.operationIds).toEqual([
      'correction',
      'manual-income',
    ]);
    // Нераспознанное и баллы не облагаются ни при каком правиле.
    const ids = result.composition.flatMap((c) => c.operationIds);
    expect(ids).not.toContain('unknown');
    expect(ids).not.toContain('bonus');
  });

  it('нетто: удержания площадки (журнал и ручные) уменьшают доход отдельной строкой', () => {
    const result = accountingTaxOf(input({ rule: 'net' }));
    expect(result.tax.incomeKopecks).toBe(90_000 - 15_000 - 1_000);
    expect(componentOf(result, 'marketplace_withheld')).toMatchObject({
      kopecks: -16_000,
      operationIds: ['commission', 'manual-expense'],
    });
  });

  it('валовая база — ровно TAX_BASE_ARTICLES P&L, второго списка нет', () => {
    expect(TAX_BASE_ARTICLES_BY_RULE.gross).toBe(TAX_BASE_ARTICLES);
    expect(TAX_BASE_ARTICLES_BY_RULE.net.commission).toBe(true);
    expect(TAX_BASE_ARTICLES_BY_RULE.net.unknown).toBe(false);
    expect(TAX_BASE_ARTICLES_BY_RULE.net.bonus_payment).toBe(false);
  });

  it('сторно журнала — тоже корректировка базы', () => {
    const items = taxBaseItemsOf(
      [op({ id: 's', article: 'returns', subArticle: 'storno', amountKopecks: 4_000 })],
      [],
      'gross',
    );
    expect(items[0].component).toBe('corrections');
  });

  it('по площадкам — отдельно, сумма — доход', () => {
    const ozonSale = op({
      id: 'ozon-sale',
      marketplace: 'ozon',
      amountKopecks: 10_000,
      paidDay: null,
    });
    const result = accountingTaxOf(input({ journal: [...JOURNAL, ozonSale] }));
    expect(result.byMarketplace).toEqual([
      { marketplace: 'ym', kopecks: 90_000, count: 5 },
      { marketplace: 'ozon', kopecks: 10_000, count: 1 },
    ]);
  });
});

describe('налог «Финучёта» — дата признания', () => {
  const PAYMENT: ITaxSettings = { ...USN_INCOME, recognition: 'payment' };

  it('ЯМ без выплаты — без даты (деньги не пришли), Ozon без paidAt — день начисления с пометкой', () => {
    const ymUnpaid = op({ id: 'ym-unpaid', amountKopecks: 50_000, paidDay: null });
    const ozon = op({ id: 'ozon', marketplace: 'ozon', amountKopecks: 10_000, paidDay: null });
    const result = accountingTaxOf(
      input({ settings: PAYMENT, journal: [SALE, ymUnpaid, ozon], manual: [] }),
    );
    expect(result.tax.incomeKopecks).toBe(110_000);
    expect(result.tax.undatedLines).toBe(1);
    expect(result.undatedOperationIds).toEqual(['ym-unpaid']);
    expect(result.paidDayFallbackLines).toBe(1);
  });

  it('по реализации подстановка не нужна и не считается', () => {
    const ozon = op({ id: 'ozon', marketplace: 'ozon', amountKopecks: 10_000, paidDay: null });
    const result = accountingTaxOf(input({ journal: [ozon], manual: [] }));
    expect(result.tax.incomeKopecks).toBe(10_000);
    expect(result.paidDayFallbackLines).toBe(0);
  });

  it('ручная операция датирована своим днём при любом признании', () => {
    const result = accountingTaxOf(
      input({ settings: PAYMENT, journal: [], manual: [MANUAL_INCOME] }),
    );
    expect(result.tax.incomeKopecks).toBe(2_000);
    expect(result.tax.undatedLines).toBe(0);
  });
});

describe('налог «Финучёта» — «Доходы минус расходы»', () => {
  const COGS = { kopecks: 30_000, unknown: { count: 1, operationIds: ['sale-2'] } };

  it('валовая: вычеты — услуги площадки, ручные расходы, опер. расходы, себестоимость v2', () => {
    const result = accountingTaxOf(input({ settings: USN_MINUS, cogs: COGS }));
    expect(result.deductible).toEqual({
      applies: true,
      marketplaceServicesKopecks: 15_000,
      manualExpensesKopecks: 1_000,
      opexKopecks: 5_000,
      cogsKopecks: 30_000,
      unknownCogs: { count: 1, operationIds: ['sale-2'] },
      totalKopecks: 51_000,
    });
    // (90 000 − 51 000) × 15 % = 5 850 > минимального 900.
    expect(result.tax.baseKopecks).toBe(39_000);
    expect(result.tax.taxKopecks).toBe(5_850);
    expect(result.tax.minimumApplied).toBe(false);
  });

  it('нетто: удержания уже в доходе — вторым вычетом не идут', () => {
    const result = accountingTaxOf(input({ settings: USN_MINUS, rule: 'net', cogs: COGS }));
    expect(result.deductible.marketplaceServicesKopecks).toBe(0);
    expect(result.deductible.manualExpensesKopecks).toBe(0);
    expect(result.deductible.totalKopecks).toBe(35_000);
    expect(result.tax.baseKopecks).toBe(74_000 - 35_000);
  });

  it('у «Доходов» вычетов нет, даже если опер. расходы переданы', () => {
    const result = accountingTaxOf(input({ cogs: COGS }));
    expect(result.deductible.applies).toBe(false);
    expect(result.deductible.totalKopecks).toBe(0);
    expect(result.tax.deductibleKopecks).toBe(0);
  });

  it('минимальный налог 1 % — когда вычеты съели базу', () => {
    const result = accountingTaxOf(
      input({
        settings: USN_MINUS,
        cogs: { kopecks: 200_000, unknown: { count: 0, operationIds: [] } },
      }),
    );
    expect(result.tax.baseKopecks).toBe(0);
    expect(result.tax.minimumApplied).toBe(true);
    expect(result.tax.taxKopecks).toBe(900);
  });
});

describe('себестоимость v2 для вычетов', () => {
  it('продажа «+», возврат товара «−», неизвестный закуп не вычитается и считается', () => {
    const lines = [
      { id: 'a', goods: 'sold' as const, count: 2, accruedDay: '2026-03-02' },
      { id: 'b', goods: 'returned' as const, count: 1, accruedDay: '2026-03-03' },
      { id: 'c', goods: 'sold' as const, count: 1, accruedDay: '2026-03-04' },
      { id: 'd', goods: 'sold' as const, count: null, accruedDay: '2026-03-04' },
      { id: 'e', goods: null, count: 1, accruedDay: '2026-03-04' },
      { id: 'f', goods: 'sold' as const, count: 1, accruedDay: '2026-04-01' },
    ];
    const units: Record<string, number | null> = {
      a: 1_000,
      b: 1_000,
      c: null,
      d: 1_000,
      f: 1_000,
    };
    // Себестоимость строки = закуп единицы × штуки (режим А).
    const cogs = taxCogsOf(lines, MARCH, (line) => {
      const unit = units[line.id];
      return unit === null || unit === undefined ? null : unit * line.count;
    });
    expect(cogs.kopecks).toBe(2 * 1_000 - 1_000);
    expect(cogs.unknown).toEqual({ count: 2, operationIds: ['c', 'd'] });
  });
});

describe('налог «Финучёта» — год и уплаченный', () => {
  it('начислено по отчётным периодам, уплачено и остаток — через taxYearOf', () => {
    const today = '2026-05-10';
    const ranges = reportingPeriodsOf(2026, today);
    const january = op({ id: 'jan', amountKopecks: 100_000, accruedDay: '2026-01-15' });
    const april = op({ id: 'apr', amountKopecks: 50_000, accruedDay: '2026-04-15' });
    const periods = ranges.map((range) => ({
      ...range,
      accounting: accountingTaxOf(
        input({
          period: { from: range.from, to: range.to },
          journal: [january, april],
          manual: [],
        }),
      ),
    }));
    const result = accountingTaxYearOf({
      year: 2026,
      today,
      settings: USN_INCOME,
      hasStaff: true,
      params: null,
      periods,
      reductions: [],
      payments: [{ paidDay: '2026-04-20', amountKopecks: 4_000 }],
      reconciliations: [],
    });
    expect(result.taxYear.periods.map((p) => [p.key, p.dueKopecks, p.advanceKopecks])).toEqual([
      ['q1', 6_000, 6_000],
      ['h1', 9_000, 3_000],
    ]);
    expect(result.taxYear.paidKopecks).toBe(4_000);
    expect(result.taxYear.balanceKopecks).toBe(5_000);
    expect(result.periods[1].accounting.composition[0].operationIds).toEqual(['jan', 'apr']);
  });
});

describe('налог на заказ — оценка по методике', () => {
  it('налог периода делится по выручке до копейки, на заказе — allocated с пометкой', () => {
    const tax = accountingTaxOf(input());
    const item = orderTaxItemOf(tax);
    expect(item).toMatchObject({ kind: 'tax', source: 'tax', kopecks: -5_400 });
    const allocation = allocateStoreCosts({
      method: 'revenue_share',
      orders: [
        { orderId: '1', revenueKopecks: 70_000, units: 1 },
        { orderId: '2', revenueKopecks: 30_001, units: 1 },
      ],
      items: [item],
    });
    const shares = [...allocation.byOrder.values()].map((a) => a.tax?.kopecks ?? 0);
    expect(shares.reduce((sum, k) => sum + k, 0)).toBe(-5_400);
    expect(allocation.byOrder.get('1')?.tax?.method).toBe('Пропорционально выручке');

    const card = orderResultOf({
      marketplace: 'ym',
      orderId: '1',
      lines: [],
      operations: [],
      costOf: () => ({ status: 'unknown', reason: 'no-product' }),
      allocations: allocation.byOrder.get('1'),
    });
    const slot = card.amounts.find((a) => a.key === 'tax_allocated');
    expect(slot).toMatchObject({ source: 'allocated', note: ORDER_TAX_ESTIMATE_NOTE });
  });

  it('методика «не распределять» — налог остаётся у периода нераспределённым', () => {
    const item = orderTaxItemOf(accountingTaxOf(input()));
    const allocation = allocateStoreCosts({
      method: 'none',
      orders: [{ orderId: '1', revenueKopecks: 70_000, units: 1 }],
      items: [item],
    });
    expect(allocation.byOrder.size).toBe(0);
    expect(allocation.unallocated.totalKopecks).toBe(-5_400);
  });

  it('налога нет — распределять нечего', () => {
    expect(orderTaxItemOf(accountingTaxOf(input({ journal: [], manual: [] })))).toBeNull();
  });
});
