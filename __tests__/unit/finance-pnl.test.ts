import type { IExpenseAllocation } from '../../src/modules/finance/expense-allocation';
import type { IPnlInput, IPnlLine } from '../../src/modules/finance/pnl';
import type { ITaxSettings } from '../../src/modules/finance/tax.domain';

import { describe, expect, it } from 'vitest';

import {
  FINANCE_ARTICLE_KEYS,
  FINANCE_ARTICLE_META,
} from '../../src/modules/finance/finance-articles';
import { monthPeriod, monthsOf } from '../../src/modules/finance/finance-period';
import { combinedPeriodStatus } from '../../src/modules/finance/finance-period-status';
import { countOf, PNL_SECTION, pnlLineOf, pnlOf } from '../../src/modules/finance/pnl';
import { SKU_COLUMN_OF, splitKopecks } from '../../src/modules/finance/pnl-sku';
import { ymGoodsMovement } from '../../src/modules/finance/ym-articles';

const SEPT = monthPeriod(2026, 9);
const NO_EXPENSES: IExpenseAllocation = { totalKopecks: 0, byCategory: {}, byExpense: [] };
const USN_6: ITaxSettings = { regime: 'usn_income', rateBasisPoints: 600, recognition: 'payment' };

let seq = 0;
function line(over: Partial<IPnlLine> = {}): IPnlLine {
  seq += 1;
  return {
    id: `op-${seq}`,
    article: 'sales',
    amountKopecks: 100_000,
    sku: 'W-1',
    count: 1,
    goods: null,
    accruedDay: '2026-09-10',
    paidDay: '2026-09-15',
    ...over,
  };
}

const sale = (over: Partial<IPnlLine> = {}) => line({ goods: 'sold', ...over });
const refund = (over: Partial<IPnlLine> = {}) =>
  line({ article: 'returns', amountKopecks: -100_000, goods: 'returned', ...over });

/** Закуп 600 ₽ за штуку у всех артикулов, кроме NO-COST. */
const flatCost = (sku: string) => (sku === 'NO-COST' ? undefined : 60_000);

function run(over: Partial<IPnlInput> = {}) {
  return pnlOf({
    lines: [],
    period: SEPT,
    costOf: flatCost,
    expenses: NO_EXPENSES,
    tax: USN_6,
    ...over,
  });
}

/** Σ всех разделов — как её посчитал бы читатель отчёта. */
function sumOfParts(pnl: ReturnType<typeof run>): number {
  let articles = 0;
  for (const key of FINANCE_ARTICLE_KEYS) {
    if (PNL_SECTION[key] !== 'reference') articles += pnl.byArticle[key].kopecks;
  }
  return articles - pnl.cogs.kopecks - pnl.operatingExpenses.totalKopecks - pnl.tax.taxKopecks;
}

describe('разделы P&L', () => {
  it('доходы журнала — в выручке или прочих доходах, расходы — у площадки', () => {
    for (const key of FINANCE_ARTICLE_KEYS) {
      const group = FINANCE_ARTICLE_META[key].group;
      const section = PNL_SECTION[key];
      if (group === 'income') expect(['revenue', 'other_income']).toContain(section);
      if (group === 'expense') expect(section).toBe('marketplace');
      if (group === 'reference') expect(section).toBe('reference');
      if (group === 'unknown') expect(section).toBe('unrecognized');
    }
  });
});

describe('движение товара строкой журнала', () => {
  it('товар двигают только платёж покупателя и его возврат', () => {
    expect(ymGoodsMovement('Начисление', 'Платёж покупателя')).toBe('sold');
    expect(ymGoodsMovement('Возврат', 'Возврат платежа покупателя')).toBe('returned');
    expect(ymGoodsMovement('Возврат', 'Возврат баллов за скидку Маркета')).toBeNull();
    expect(ymGoodsMovement('Начисление', 'Утрата или порча товаров в доставке')).toBeNull();
    expect(ymGoodsMovement('Удержание', 'Оплата услуг Маркета')).toBeNull();
  });

  it('штуки — только целое > 0 из сырой строки', () => {
    expect(countOf('2')).toBe(2);
    expect(countOf(null)).toBeNull();
    expect(countOf('')).toBeNull();
    expect(countOf('0')).toBeNull();
    expect(countOf('1.5')).toBeNull();
  });

  it('операция → строка: дни по Москве, движение по типу и источнику', () => {
    const result = pnlLineOf({
      id: 'x',
      article: 'sales',
      amountKopecks: 1,
      orderId: '1',
      sku: 'W-1',
      serviceName: null,
      transactionType: 'Начисление',
      transactionSource: 'Платёж покупателя',
      // 22:30 UTC — уже следующий день по Москве.
      accruedAt: new Date('2026-09-30T22:30:00Z'),
      paidAt: null,
      actDate: null,
      count: '3',
    });
    expect(result).toMatchObject({
      accruedDay: '2026-10-01',
      paidDay: null,
      goods: 'sold',
      count: 3,
      orderId: '1',
    });
  });
});

describe('продажа → возврат → сторно комиссии', () => {
  it('ноль выручки, ноль комиссии, ноль себестоимости', () => {
    const pnl = run({
      lines: [
        sale(),
        line({ article: 'subsidies', amountKopecks: 10_000 }),
        line({ article: 'commission', amountKopecks: -23_000, sku: null }),
        refund(),
        // Возврат баллов — та же статья returns, но товар не двигает.
        line({ article: 'returns', amountKopecks: -10_000 }),
        line({ article: 'commission', amountKopecks: 23_000, sku: null }),
      ],
    });
    expect(pnl.revenueKopecks).toBe(0);
    expect(pnl.byArticle.commission.kopecks).toBe(0);
    expect(pnl.cogs.kopecks).toBe(0);
    expect(pnl.netKopecks).toBe(0);
    expect(pnl.unconfirmed.confirmed).toBe(true);
  });

  it('компенсация за утерю не дублирует возврат: товар не вернулся, себестоимость остаётся', () => {
    const pnl = run({
      lines: [sale(), line({ article: 'compensations', amountKopecks: 70_000, goods: null })],
    });
    expect(pnl.revenueKopecks).toBe(100_000);
    expect(pnl.otherIncomeKopecks).toBe(70_000);
    expect(pnl.cogs.kopecks).toBe(60_000);
    expect(pnl.byArticle.returns.kopecks).toBe(0);
  });
});

describe('уровни и сумма статей', () => {
  const lines = [
    sale({ count: 2, amountKopecks: 200_000 }),
    sale({ sku: 'W-2', amountKopecks: 150_000 }),
    line({ article: 'subsidies', amountKopecks: 30_000 }),
    line({ article: 'compensations', amountKopecks: 5_000 }),
    line({ article: 'commission', amountKopecks: -46_000 }),
    line({ article: 'delivery_to_buyer', amountKopecks: -12_345 }),
    line({ article: 'other_services', amountKopecks: -51_852 }),
    line({ article: 'unknown', amountKopecks: -999 }),
    line({ article: 'bonus_payment', amountKopecks: -77_777 }),
  ];
  const expenses: IExpenseAllocation = {
    totalKopecks: 30_000,
    byCategory: { rent: 30_000 },
    byExpense: [{ id: 'e1', kopecks: 30_000 }],
  };

  it('Σ статей − себестоимость − опер. расходы − налог = чистая', () => {
    const pnl = run({ lines, expenses });
    expect(sumOfParts(pnl)).toBe(pnl.netKopecks);
    expect(pnl.grossKopecks).toBe(380_000 + 5_000 - 180_000);
    expect(pnl.marketplaceKopecks).toBe(-46_000 - 12_345 - 51_852);
    expect(pnl.unrecognizedKopecks).toBe(-999);
    expect(pnl.operatingKopecks).toBe(pnl.afterMarketplaceKopecks - 30_000);
    expect(pnl.netMargin).toBeCloseTo(pnl.netKopecks / 380_000);
  });

  it('оплачено баллами — справочно, в чистую не входит', () => {
    const without = run({ lines: lines.filter((l) => l.article !== 'bonus_payment'), expenses });
    const pnl = run({ lines, expenses });
    expect(pnl.reference.kopecks).toBe(-77_777);
    expect(pnl.netKopecks).toBe(without.netKopecks);
  });

  it('налог УСН «Доходы» — от выручки и компенсаций, без нераспознанного', () => {
    const pnl = run({ lines, expenses });
    expect(pnl.tax.incomeKopecks).toBe(385_000);
    expect(pnl.tax.taxKopecks).toBe(23_100);
  });

  it('раскрытие статьи — ids тех самых строк', () => {
    const pnl = run({ lines, expenses });
    expect(pnl.byArticle.commission.operationIds).toEqual([lines[4].id]);
    expect(pnl.cogs.bySku.find((s) => s.sku === 'W-1')).toMatchObject({
      count: 2,
      kopecks: 120_000,
      operationIds: [lines[0].id],
    });
  });

  it('случайный журнал: Σ статей = чистая при любых режимах', () => {
    const articles = FINANCE_ARTICLE_KEYS;
    for (let round = 0; round < 50; round += 1) {
      const random: IPnlLine[] = Array.from({ length: 40 }, (_, i) => {
        const article = articles[(round * 7 + i * 13) % articles.length];
        const goods =
          article === 'sales' ? 'sold' : article === 'returns' && i % 2 ? 'returned' : null;
        return line({
          article,
          goods,
          sku: i % 5 ? `S-${i % 4}` : 'NO-COST',
          count: (i % 3) + 1,
          amountKopecks: ((i * 7919 + round * 104_729) % 200_001) - 100_000,
          accruedDay: `2026-${i % 6 ? '09' : '08'}-${String((i % 28) + 1).padStart(2, '0')}`,
          paidDay: i % 4 ? `2026-09-${String((i % 28) + 1).padStart(2, '0')}` : null,
        });
      });
      for (const regime of ['usn_income', 'usn_income_minus_expenses'] as const) {
        const pnl = run({ lines: random, expenses, tax: { ...USN_6, regime } });
        expect(sumOfParts(pnl)).toBe(pnl.netKopecks);
      }
    }
  });
});

describe('себестоимость', () => {
  it('закупа нет на дату — выручка остаётся, P&L неполный', () => {
    const pnl = run({ lines: [sale({ sku: 'NO-COST', count: 2 }), sale()] });
    expect(pnl.revenueKopecks).toBe(200_000);
    expect(pnl.cogs.kopecks).toBe(60_000);
    expect(pnl.cogs.unknown).toMatchObject([{ sku: 'NO-COST', count: 2 }]);
    expect(pnl.unconfirmed).toEqual({
      confirmed: false,
      orders: 1,
      revenueKopecks: 100_000,
      skus: ['NO-COST'],
    });
  });

  it('признак «не подтверждена» считает заказы, а не строки, и не трогает выручку и чистую', () => {
    const known = [sale({ orderId: 'K-1' })];
    const unknown = [
      sale({ sku: 'NO-COST', orderId: 'U-1' }),
      sale({ sku: 'NO-COST', orderId: 'U-1', amountKopecks: 50_000 }),
      sale({ sku: '', orderId: null, amountKopecks: 30_000 }),
    ];
    const pnl = run({ lines: [...known, ...unknown] });
    expect(pnl.unconfirmed.orders).toBe(2);
    expect(pnl.unconfirmed.revenueKopecks).toBe(180_000);
    expect(pnl.unconfirmed.skus).toEqual(['NO-COST', '(без артикула)']);
    // pnl_unknown_cost_keeps_revenue: выручка без закупа остаётся.
    expect(pnl.revenueKopecks).toBe(280_000);
    expect(pnl.cogs.kopecks).toBe(60_000);
  });

  it('число штук неизвестно — себестоимость не угадывается', () => {
    const pnl = run({ lines: [sale({ count: null })] });
    expect(pnl.cogs.kopecks).toBe(0);
    expect(pnl.unconfirmed.confirmed).toBe(false);
    expect(pnl.unconfirmed.orders).toBe(1);
  });

  it('закуп берётся на день строки продажи', () => {
    const asked: string[] = [];
    run({
      lines: [sale({ accruedDay: '2026-09-03' })],
      costOf: (_sku, day) => {
        asked.push(day);
        return 1;
      },
    });
    expect(asked).toEqual(['2026-09-03']);
  });

  it('закупки партии в журнале нет — себестоимость только от строк, двигающих товар', () => {
    const pnl = run({
      lines: [line({ article: 'withholdings', amountKopecks: -500_000, goods: null, count: 100 })],
    });
    expect(pnl.cogs.kopecks).toBe(0);
    expect(pnl.cogs.bySku).toEqual([]);
  });
});

describe('период и налог', () => {
  it('в уровни — по дню начисления; в налог по поступлению — и начисленное раньше', () => {
    const august = sale({ accruedDay: '2026-08-28', paidDay: '2026-09-02' });
    const unpaid = sale({ accruedDay: '2026-09-29', paidDay: null });
    const pnl = run({ lines: [august, unpaid] });
    expect(pnl.revenueKopecks).toBe(100_000);
    expect(pnl.byArticle.sales.operationIds).toEqual([unpaid.id]);
    expect(pnl.tax.incomeKopecks).toBe(100_000);
    expect(pnl.tax.undatedLines).toBe(1);
  });

  it('по дате реализации — налог от начисленного в периоде', () => {
    const august = sale({ accruedDay: '2026-08-28', paidDay: '2026-09-02' });
    const pnl = run({
      lines: [august, sale({ paidDay: null })],
      tax: { ...USN_6, recognition: 'realization' },
    });
    expect(pnl.tax.incomeKopecks).toBe(100_000);
    expect(pnl.tax.undatedLines).toBe(0);
  });

  it('«Доходы минус расходы» вычитает себестоимость, услуги и опер. расходы', () => {
    const pnl = run({
      lines: [sale(), line({ article: 'commission', amountKopecks: -20_000 })],
      expenses: { totalKopecks: 5_000, byCategory: {}, byExpense: [] },
      tax: { regime: 'usn_income_minus_expenses', rateBasisPoints: 1500, recognition: 'payment' },
    });
    expect(pnl.tax.deductibleKopecks).toBe(60_000 + 20_000 + 5_000);
    expect(pnl.tax.taxKopecks).toBe(2_250);
  });
});

describe('статус периода из месяцев', () => {
  it('месяцы периода — от первого к последнему', () => {
    expect(monthsOf({ from: '2026-11-15', to: '2027-01-05' }).map((m) => m.from)).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
  });

  it('расхождение побеждает, «Проверено» — только когда проверены все', () => {
    expect(combinedPeriodStatus(['verified', 'discrepancy'])).toBe('discrepancy');
    expect(combinedPeriodStatus(['verified', 'verified'])).toBe('verified');
    expect(combinedPeriodStatus(['verified', null])).toBe('preliminary');
    expect(combinedPeriodStatus([])).toBe('preliminary');
  });
});

describe('заказы и штуки периода (TASK-125)', () => {
  it('заказы — различные orderId строк продажи, штуки — продано минус вернулось', () => {
    const pnl = run({
      lines: [
        sale({ orderId: 'A', count: 2 }),
        sale({ orderId: 'A', count: 1, sku: 'W-2' }),
        sale({ orderId: 'B', count: 1, sku: 'NO-COST' }),
        refund({ orderId: 'B', count: 1, sku: 'NO-COST' }),
        line({ article: 'commission', amountKopecks: -5_000, orderId: 'C', goods: null }),
        sale({ orderId: 'D', accruedDay: '2026-10-01' }),
      ],
    });
    expect(pnl.ordersCount).toBe(2);
    // 2 + 1 учтённых, 1 − 1 без закупа: число не зависит от полноты прайса.
    expect(pnl.units).toBe(3);
  });

  it('без продаж — ноль заказов и штук', () => {
    const pnl = run({ lines: [line({ article: 'storage', amountKopecks: -100, goods: null })] });
    expect(pnl.ordersCount).toBe(0);
    expect(pnl.units).toBe(0);
  });
});

describe('разрез по товарам (TASK-138)', () => {
  /** Σ чистой товаров + «не относится к товару» — должна совпасть с чистой P&L. */
  const skuNetSum = (pnl: ReturnType<typeof run>) =>
    pnl.skus.skus.reduce((sum, sku) => sum + sku.netKopecks, 0) + pnl.skus.rest.netKopecks;

  const mixedPeriod = () =>
    run({
      lines: [
        sale({ orderId: 'O1', sku: 'A', amountKopecks: 300_000, count: 1, scheme: 'FBS' }),
        sale({ orderId: 'O1', sku: 'B', amountKopecks: 100_001, count: 1, scheme: 'FBS' }),
        line({
          orderId: 'O1',
          sku: null,
          article: 'commission',
          amountKopecks: -40_003,
          scheme: 'FBS',
        }),
        line({ orderId: 'O1', sku: null, article: 'delivery_to_buyer', amountKopecks: -9_999 }),
        sale({ orderId: 'O2', sku: 'NO-COST', amountKopecks: 50_000, count: 2, scheme: 'FBY' }),
        line({ sku: 'A', article: 'promotion', amountKopecks: -7_000 }),
        line({ orderId: null, sku: null, article: 'other_services', amountKopecks: -16_990 }),
        line({ orderId: 'GONE', sku: null, article: 'storage', amountKopecks: -500 }),
        line({ sku: null, article: 'unknown', amountKopecks: 1_234 }),
        line({ sku: 'A', article: 'bonus_payment', amountKopecks: -2_000 }),
        refund({ orderId: 'O1', sku: 'B', amountKopecks: -100_001, count: 1, scheme: 'FBS' }),
      ],
      expenses: { totalKopecks: 25_000, byCategory: {}, byExpense: [] },
    });

  it('Σ чистой товаров + «не относится» = чистая P&L до копейки', () => {
    const pnl = mixedPeriod();
    expect(skuNetSum(pnl)).toBe(pnl.netKopecks);
    // Σ статей «Финансов» не изменилась от появления разреза.
    expect(sumOfParts(pnl)).toBe(pnl.netKopecks);
  });

  it('заказная строка без артикула делится по продаже позиций, Σ кусков = строке', () => {
    const pnl = run({
      lines: [
        sale({ orderId: 'O1', sku: 'A', amountKopecks: 300_000 }),
        sale({ orderId: 'O1', sku: 'B', amountKopecks: 100_000 }),
        line({ orderId: 'O1', sku: null, article: 'commission', amountKopecks: -40_001 }),
      ],
    });
    const bySku = Object.fromEntries(pnl.skus.skus.map((s) => [s.sku, s.columns.commission]));
    expect(bySku.A + bySku.B).toBe(-40_001);
    expect(Math.abs(bySku.A)).toBeGreaterThan(Math.abs(bySku.B) * 2.9);
  });

  it('доставка, начисленная в этом месяце по заказу прошлого, делится по продаже прошлого', () => {
    const pnl = run({
      lines: [
        sale({ orderId: 'O9', sku: 'A', amountKopecks: 100_000, accruedDay: '2026-08-30' }),
        line({ orderId: 'O9', sku: null, article: 'delivery_to_buyer', amountKopecks: -5_000 }),
      ],
    });
    expect(pnl.skus.skus).toHaveLength(1);
    expect(pnl.skus.skus[0]).toMatchObject({ sku: 'A', units: 0 });
    expect(pnl.skus.skus[0].columns.logistics).toBe(-5_000);
    expect(pnl.skus.rest.lines).toBe(0);
  });

  it('подписка без заказа и строка неизвестного заказа — в «не относится», опер. расходы — там же', () => {
    const pnl = mixedPeriod();
    expect(pnl.skus.rest.columns.otherServices).toBe(-16_990 - 500);
    expect(pnl.skus.rest.columns.unrecognized).toBe(1_234);
    expect(pnl.skus.rest.operatingKopecks).toBe(25_000);
    expect(pnl.skus.rest.lines).toBe(3);
  });

  it('налог раскладывается по базе и в сумме равен налогу периода', () => {
    const pnl = mixedPeriod();
    const taxSum =
      pnl.skus.skus.reduce((sum, s) => sum + s.taxKopecks, 0) + pnl.skus.rest.taxKopecks;
    expect(taxSum).toBe(pnl.tax.taxKopecks);
    expect(pnl.tax.taxKopecks).toBeGreaterThan(0);
  });

  it('штуки, заказы, себестоимость и схема — по товару; нет закупа → costKnown: false', () => {
    const pnl = mixedPeriod();
    const a = pnl.skus.skus.find((s) => s.sku === 'A');
    const b = pnl.skus.skus.find((s) => s.sku === 'B');
    const noCost = pnl.skus.skus.find((s) => s.sku === 'NO-COST');
    expect(a).toMatchObject({ units: 1, orders: 1, cogsKopecks: 60_000, costKnown: true });
    expect(b).toMatchObject({ units: 0, cogsKopecks: 0, costKnown: true });
    expect(noCost).toMatchObject({ units: 2, cogsKopecks: 0, costKnown: false, scheme: 'FBY' });
    // У A строки FBS и строка продвижения без схемы — две части, у товара схема не одна.
    expect(a?.schemes.map((s) => s.scheme).sort()).toEqual(['FBS', null]);
    expect(a?.scheme).toBeNull();
    const schemeNet = (a?.schemes ?? []).reduce((sum, s) => sum + s.netKopecks, 0);
    expect(schemeNet).toBe(a?.netKopecks);
  });

  it('справочная строка с артикулом не заводит товара', () => {
    const pnl = run({ lines: [line({ sku: 'X', article: 'bonus_payment', amountKopecks: -100 })] });
    expect(pnl.skus.skus).toEqual([]);
  });

  it('у каждой статьи есть решение: колонка или вне денег — только справочная', () => {
    for (const key of FINANCE_ARTICLE_KEYS) {
      expect(SKU_COLUMN_OF[key] === null).toBe(PNL_SECTION[key] === 'reference');
    }
  });
});

describe('продажи по дням (TASK-140)', () => {
  it('Σ дней = выручке, штукам и заказам периода', () => {
    const pnl = run({
      lines: [
        sale({ orderId: 'o1', count: 2, amountKopecks: 200_000, accruedDay: '2026-09-03' }),
        line({ article: 'subsidies', orderId: 'o1', amountKopecks: 15_000, accruedDay: '2026-09-04' }),
        sale({ orderId: 'o2', sku: 'NO-COST', accruedDay: '2026-09-04' }),
        refund({ orderId: 'o1', accruedDay: '2026-09-20' }),
        // Комиссия — не выручка: в ряд продаж не идёт.
        line({ article: 'commission', orderId: 'o1', sku: null, amountKopecks: -30_000 }),
        // Начислено в августе — вне периода.
        sale({ orderId: 'o9', accruedDay: '2026-08-31' }),
      ],
    });
    const days = pnl.salesByDay;
    // День одной лишь комиссии в ряд не заводится — продаж в нём нет.
    expect(days.map((d) => d.day)).toEqual(['2026-09-03', '2026-09-04', '2026-09-20']);
    expect(days.reduce((s, d) => s + d.revenueKopecks, 0)).toBe(pnl.revenueKopecks);
    expect(days.reduce((s, d) => s + d.units, 0)).toBe(pnl.units);
    expect(days.reduce((s, d) => s + d.orders, 0)).toBe(pnl.ordersCount);
    expect(days.find((d) => d.day === '2026-09-20')).toEqual({
      day: '2026-09-20',
      revenueKopecks: -100_000,
      units: -1,
      orders: 0,
    });
  });

  it('заказ с продажами в два дня идёт в день первой продажи, один раз', () => {
    const pnl = run({
      lines: [
        sale({ orderId: 'o1', sku: 'A', accruedDay: '2026-09-12' }),
        sale({ orderId: 'o1', sku: 'B', accruedDay: '2026-09-11' }),
      ],
    });
    expect(pnl.ordersCount).toBe(1);
    expect(pnl.salesByDay.map((d) => [d.day, d.orders])).toEqual([
      ['2026-09-11', 1],
      ['2026-09-12', 0],
    ]);
  });

  it('штуки продажи без артикула — в «не относится к товару», Σ штук товаров + её = итогу', () => {
    const pnl = run({
      lines: [sale({ orderId: 'o1', count: 3 }), sale({ orderId: null, sku: null, count: 2 })],
    });
    expect(pnl.units).toBe(5);
    expect(pnl.skus.rest.units).toBe(2);
    expect(pnl.skus.skus.reduce((s, sku) => s + sku.units, 0) + pnl.skus.rest.units).toBe(5);
  });
});

describe('штуки артикула по дням (TASK-141)', () => {
  it('Σ дней артикула = его штукам в разрезе; строка без артикула не попадает', () => {
    const pnl = run({
      lines: [
        sale({ orderId: 'o1', sku: 'A', count: 2, accruedDay: '2026-09-03' }),
        sale({ orderId: 'o2', sku: 'A', count: 1, accruedDay: '2026-09-03' }),
        sale({ orderId: 'o3', sku: 'B', count: 1, accruedDay: '2026-09-05' }),
        refund({ orderId: 'o1', sku: 'A', accruedDay: '2026-09-20' }),
        sale({ orderId: null, sku: null, count: 4, accruedDay: '2026-09-07' }),
        // Комиссия штук не двигает.
        line({ article: 'commission', orderId: 'o1', sku: 'A', amountKopecks: -30_000 }),
        // Вне периода.
        sale({ orderId: 'o9', sku: 'A', accruedDay: '2026-08-31' }),
      ],
    });
    expect(pnl.skuSalesByDay).toEqual([
      { sku: 'A', day: '2026-09-03', units: 3 },
      { sku: 'A', day: '2026-09-20', units: -1 },
      { sku: 'B', day: '2026-09-05', units: 1 },
    ]);
    for (const row of pnl.skus.skus) {
      const days = pnl.skuSalesByDay.filter((d) => d.sku === row.sku);
      expect(days.reduce((s, d) => s + d.units, 0)).toBe(row.units);
    }
  });
});

describe('splitKopecks', () => {
  it('Σ = сумме, остаток — наибольшим дробным, знак сохраняется', () => {
    expect(splitKopecks(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(splitKopecks(-10, [1, 1, 1])).toEqual([-4, -3, -3]);
    expect(splitKopecks(1, [3, 1])).toEqual([1, 0]);
    expect(splitKopecks(0, [5, 5])).toEqual([0, 0]);
  });

  it('без положительных весов — ошибка, а не тихая потеря копеек', () => {
    expect(() => splitKopecks(5, [0, 0])).toThrow();
  });
});
