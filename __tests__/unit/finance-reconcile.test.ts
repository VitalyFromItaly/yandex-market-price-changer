import type {
  IReconcileInput,
  IReconcileOperation,
} from '../../src/modules/finance/finance-reconcile';

import { describe, expect, it } from 'vitest';

import { monthPeriod } from '../../src/modules/finance/finance-period';
import {
  actMatches,
  countByKind,
  MAX_FINDING_OPERATION_REFS,
  orderIdsToLookup,
  reconcile,
  RECONCILE_TOLERANCE_KOPECKS,
} from '../../src/modules/finance/finance-reconcile';

const SEPT = 'united-netting:2026-09-01:2026-09-30';
const AUG = 'united-netting:2026-08-01:2026-08-31';
const OCT = 'united-netting:2026-10-01:2026-10-31';

let seq = 0;
function op(over: Partial<IReconcileOperation> = {}): IReconcileOperation {
  seq += 1;
  return {
    id: `op-${seq}`,
    orderId: '100',
    article: 'sales',
    amountKopecks: 100_000,
    bankOrderId: null,
    bankSumKopecks: null,
    paidAt: null,
    periodKey: SEPT,
    ...over,
  };
}

function input(over: Partial<IReconcileInput> = {}): IReconcileInput {
  return {
    period: monthPeriod(2026, 9),
    periodKey: SEPT,
    operations: [],
    deliveredOrderIds: new Set(),
    existingOrderIds: new Set(),
    neighbors: { prev: true, next: true },
    ...over,
  };
}

/** Дата поручения — как её кладёт parseYmDate: полночь по Москве. */
const msk = (day: string) => new Date(`${day}T00:00:00+03:00`);

describe('сверка: выкуплен без начислений', () => {
  it('выкупленный заказ без продажи — находка со ссылками на его операции', () => {
    const commission = op({ orderId: '200', article: 'commission', amountKopecks: -5000 });
    const result = reconcile(
      input({ operations: [commission], deliveredOrderIds: new Set(['200', '300']) }),
    );
    const found = result.findings.filter((f) => f.kind === 'delivered_without_accrual');
    expect(found.map((f) => f.orderId)).toEqual(['200', '300']);
    expect(found[0].operationIds).toEqual([commission.id]);
    expect(found[1].operationCount).toBe(0);
  });

  it('продажа в отчёте соседнего месяца гасит находку — ищем по всему журналу', () => {
    // Предоплата: начислено при оплате в августе, выкуплен в сентябре.
    const result = reconcile(
      input({
        operations: [op({ orderId: '200', periodKey: AUG })],
        deliveredOrderIds: new Set(['200']),
      }),
    );
    expect(result.findings).toEqual([]);
  });
});

describe('сверка: начисление по заказу, которого нет', () => {
  it('заказ месяца, которого Маркет не нашёл, — находка с суммой', () => {
    const ops = [
      op({ orderId: '777' }),
      op({ orderId: '777', article: 'commission', amountKopecks: -100 }),
    ];
    const result = reconcile(input({ operations: ops, existingOrderIds: new Set() }));
    expect(result.findings).toMatchObject([
      { kind: 'accrual_without_order', orderId: '777', actualKopecks: 99_900, operationCount: 2 },
    ]);
  });

  it('найденный или выкупленный заказ — не находка; спрашиваем только про невыкупленные', () => {
    const ops = [op({ orderId: '1' }), op({ orderId: '2' }), op({ orderId: '3', periodKey: OCT })];
    const base = { operations: ops, deliveredOrderIds: new Set(['1']) };
    expect(orderIdsToLookup({ ...base, periodKey: SEPT })).toEqual(['2']);
    expect(reconcile(input({ ...base, existingOrderIds: new Set(['2']) })).findings).toEqual([]);
  });

  it('справочные строки (оплачено баллами) заказа не требуют', () => {
    const ops = [op({ orderId: '9', article: 'bonus_payment' })];
    expect(
      orderIdsToLookup({ operations: ops, periodKey: SEPT, deliveredOrderIds: new Set() }),
    ).toEqual([]);
  });
});

describe('сверка: Σ операций ≠ выплата', () => {
  const paid = (amount: number, over: Partial<IReconcileOperation> = {}) =>
    op({
      amountKopecks: amount,
      bankOrderId: 'P1',
      bankSumKopecks: 150_000,
      paidAt: msk('2026-09-14'),
      ...over,
    });

  it('сошлось до копейки — чисто, даже если строки в разных отчётах', () => {
    const ops = [paid(100_000), paid(50_000, { periodKey: AUG })];
    expect(
      reconcile(input({ operations: ops, existingOrderIds: new Set(['100']) })).findings,
    ).toEqual([]);
  });

  it(`допуск ${RECONCILE_TOLERANCE_KOPECKS} коп.: копейка разницы — уже находка`, () => {
    const ops = [paid(100_000), paid(49_999)];
    const [finding] = reconcile(
      input({ operations: ops, existingOrderIds: new Set(['100']) }),
    ).findings;
    expect(finding).toMatchObject({
      kind: 'payment_mismatch',
      bankOrderId: 'P1',
      expectedKopecks: 150_000,
      actualKopecks: 149_999,
    });
  });

  it('справочные строки в сумму выплаты не входят', () => {
    const ops = [paid(150_000), paid(-7_000, { article: 'bonus_payment' })];
    expect(
      reconcile(input({ operations: ops, existingOrderIds: new Set(['100']) })).findings,
    ).toEqual([]);
  });

  it('разные суммы поручения у строк — находка', () => {
    const ops = [paid(100_000), paid(50_000, { bankSumKopecks: 160_000 })];
    expect(
      reconcile(input({ operations: ops, existingOrderIds: new Set(['100']) })).findings[0].detail,
    ).toContain('разные суммы');
  });

  it('поручение другого месяца не сверяется в этом', () => {
    const ops = [paid(1, { paidAt: msk('2026-10-05') })];
    expect(
      reconcile(input({ operations: ops, existingOrderIds: new Set(['100']) })).findings,
    ).toEqual([]);
  });

  it('ссылок в находке не больше потолка, счётчик — полный', () => {
    const ops = Array.from({ length: MAX_FINDING_OPERATION_REFS + 5 }, () => paid(1));
    const [finding] = reconcile(
      input({ operations: ops, existingOrderIds: new Set(['100']) }),
    ).findings;
    expect(finding.operationIds).toHaveLength(MAX_FINDING_OPERATION_REFS);
    expect(finding.operationCount).toBe(MAX_FINDING_OPERATION_REFS + 5);
  });
});

describe('сверка: строки без статьи и соседи', () => {
  it('строка месяца без статьи — находка на каждую', () => {
    const ops = [
      op({ article: 'unknown', orderId: null }),
      op({ article: 'unknown', periodKey: AUG }),
    ];
    const result = reconcile(input({ operations: ops, existingOrderIds: new Set(['100']) }));
    expect(countByKind(result.findings).unknown_article).toBe(1);
  });

  it('нет следующего месяца — заказы и выплаты не сверяются, статьи — да', () => {
    const result = reconcile(
      input({
        operations: [op({ article: 'unknown' })],
        deliveredOrderIds: new Set(['555']),
        neighbors: { prev: true, next: false },
      }),
    );
    expect(result.unchecked).toContain('следующего');
    expect(result.findings.map((f) => f.kind)).toEqual(['unknown_article']);
  });
});

describe('сверка: акт с отчётом услуг (TASK-158)', () => {
  const act = (servicesKopecks: number | null, journalKopecks = -46_990_339) => ({
    actDay: '2026-09-30',
    journal: { kopecks: journalKopecks, operationCount: 2, operationIds: ['a', 'b'] },
    servicesKopecks,
  });

  it('услуги = −Σ журнала до копейки — находок нет, сверка полная', () => {
    const result = reconcile(input({ acts: [act(46_990_339)] }));
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toBeNull();
  });

  it('разница в копейку — находка с суммами и ссылками на строки', () => {
    const [finding] = reconcile(input({ acts: [act(46_990_340)] })).findings;
    expect(finding).toMatchObject({
      kind: 'act_mismatch',
      expectedKopecks: 46_990_340,
      actualKopecks: 46_990_339,
      operationIds: ['a', 'b'],
      operationCount: 2,
    });
    expect(finding.detail).toContain('Акт 30.09.2026');
    expect(finding.detail).toContain('0,01 ₽');
    expect(RECONCILE_TOLERANCE_KOPECKS).toBe(0);
  });

  it('нет отчёта услуг — не находка, а неполная сверка с датой акта', () => {
    const result = reconcile(input({ acts: [act(null)] }));
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toContain('30.09.2026');
  });

  it('акт сверяется и без соседних месяцев; причины неполноты склеиваются', () => {
    const result = reconcile(
      input({ acts: [act(1), act(null)], neighbors: { prev: false, next: true } }),
    );
    expect(result.findings.map((f) => f.kind)).toEqual(['act_mismatch']);
    expect(result.unchecked).toContain('прошлого');
    expect(result.unchecked).toContain('отчёта услуг');
  });

  it('исход по актам для импорта: сошёлся, не сошёлся; без отчёта — не решаем', () => {
    const july = { ...act(1), actDay: '2026-07-31' };
    const august = { ...act(null), actDay: '2026-08-31' };
    expect(actMatches([act(46_990_339), july, august])).toEqual(
      new Map([
        ['2026-09-30', true],
        ['2026-07-31', false],
      ]),
    );
  });
});

describe('сверка на данных Ozon (TASK-132)', () => {
  const OZON_SEPT = 'ozon-transaction-list:2026-09-01:2026-09-30';
  const OZON_OCT = 'ozon-transaction-list:2026-10-01:2026-10-31';
  const ozonInput = (over: Partial<IReconcileInput> = {}) =>
    input({ periodKey: OZON_SEPT, ...over });

  it('та же функция: отправления — posting_number, актов и поручений нет', () => {
    const operations = [
      // Выкуплен в сентябре, продажа начислена в октябре — по всему журналу сходится.
      op({ orderId: '12345678-0001-1', periodKey: OZON_OCT }),
      // Логистика по отправлению, которого Ozon не знает.
      op({ orderId: '99999999-0001-1', article: 'delivery_to_buyer', amountKopecks: -7000, periodKey: OZON_SEPT }),
      op({ orderId: null, article: 'storage', amountKopecks: -100, periodKey: OZON_SEPT }),
    ];
    const delivered = new Set(['12345678-0001-1', '22222222-0001-1']);
    expect(orderIdsToLookup({ operations, periodKey: OZON_SEPT, deliveredOrderIds: delivered })).toEqual([
      '99999999-0001-1',
    ]);
    const result = reconcile(ozonInput({ operations, deliveredOrderIds: delivered }));
    expect(result.unchecked).toBeNull();
    expect(result.findings.map((f) => [f.kind, f.orderId])).toEqual([
      ['delivered_without_accrual', '22222222-0001-1'],
      ['accrual_without_order', '99999999-0001-1'],
    ]);
  });

  it('без следующего месяца — «не проверено», заказы не сверяются', () => {
    const result = reconcile(
      ozonInput({ deliveredOrderIds: new Set(['12345678-0001-1']), neighbors: { prev: true, next: false } }),
    );
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toMatch(/следующего месяца/);
  });
});
