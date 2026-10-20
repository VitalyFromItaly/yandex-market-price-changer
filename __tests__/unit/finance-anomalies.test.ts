import type { IAnomalyInput } from '../../src/modules/finance/finance-anomalies';
import type { IReconcileFinding } from '../../src/modules/finance/finance-reconcile';
import type { IPnlOperation } from '../../src/modules/finance/pnl';

import { describe, expect, it } from 'vitest';

import {
  ANOMALY_KIND_LABEL,
  ANOMALY_KINDS,
  ANOMALY_THRESHOLDS,
  anomalyHistoryStart,
  detectAnomalies,
  median,
  rubText,
} from '../../src/modules/finance/finance-anomalies';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { MAX_FINDING_OPERATION_REFS } from '../../src/modules/finance/finance-reconcile';

/** Детектор аномалий журнала (TASK-149): по describe на каждый детектор. */

const SEPT = monthPeriod(2026, 9);
const SEPT_KEY = financePeriodKey('united-netting', SEPT);

let seq = 0;
/** Полдень по Москве нужного дня. */
const at = (day: string) => new Date(`${day}T12:00:00+03:00`);

function op(over: Partial<IPnlOperation> & { day?: string } = {}): IPnlOperation {
  const { day = '2026-09-10', ...rest } = over;
  seq += 1;
  return {
    id: `op-${String(seq).padStart(5, '0')}`,
    article: 'sales',
    amountKopecks: 100_000,
    orderId: '100',
    sku: 'A1',
    serviceName: null,
    transactionType: 'Начисление',
    transactionSource: 'Платёж покупателя',
    accruedAt: at(day),
    paidAt: null,
    actDate: null,
    model: 'FBS',
    count: '1',
    ...rest,
  };
}

type TSkuRow = { sku: string; units: number; logistics: number };

function input(
  over: Partial<Omit<IAnomalyInput, 'pnl'>> & {
    skus?: TSkuRow[];
    unknown?: IAnomalyInput['pnl']['cogs']['unknown'];
  } = {},
): IAnomalyInput {
  const { skus = [], unknown = [], ...rest } = over;
  return {
    period: SEPT,
    periodKey: SEPT_KEY,
    operations: [],
    discrepancies: [],
    pnl: {
      skus: {
        skus: skus.map((s) => ({
          sku: s.sku,
          units: s.units,
          columns: { logistics: s.logistics },
        })),
        rest: {},
      } as never,
      cogs: { kopecks: 0, bySku: [], unknown },
    },
    ...rest,
  };
}

const kinds = (inp: IAnomalyInput) => detectAnomalies(inp).map((a) => a.kind);

/** Месяц с выручкой 1 000 000 ₽ и комиссией `share` от неё. */
function month(day: string, share: number): IPnlOperation[] {
  const revenue = 100_000_000;
  return [
    op({ day, amountKopecks: revenue }),
    op({
      day,
      article: 'commission',
      amountKopecks: -Math.round(revenue * share),
      transactionType: 'Удержание',
      serviceName: 'Размещение',
    }),
  ];
}

describe('утилиты', () => {
  it('медиана, рубли, начало истории', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(rubText(-123_456_789)).toBe('−1 234 567,89 ₽');
    expect(rubText(5)).toBe('0,05 ₽');
    expect(anomalyHistoryStart(SEPT)).toBe('2026-03-01');
    expect(anomalyHistoryStart(monthPeriod(2026, 2))).toBe('2025-08-01');
  });

  it('у каждого вида есть подпись', () => {
    for (const kind of ANOMALY_KINDS) expect(ANOMALY_KIND_LABEL[kind]).toBeTruthy();
  });
});

describe('скачок доли комиссии', () => {
  const history = [
    ...month('2026-06-10', 0.2),
    ...month('2026-07-10', 0.21),
    ...month('2026-08-10', 0.19),
  ];

  it('рост выше обоих порогов — аномалия со ссылками на комиссию месяца', () => {
    const found = detectAnomalies(input({ operations: [...history, ...month('2026-09-10', 0.3)] }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'commission_spike',
      key: `commission_spike:${SEPT_KEY}`,
      operationCount: 1,
      amountKopecks: -30_000_000,
    });
    expect(found[0].detail).toContain('30,0 %');
    expect(found[0].detail).toContain('20,0 %');
  });

  it('ниже порога в п.п. или в разах — тишина', () => {
    // +2 п.п. при росте ×1.1.
    expect(kinds(input({ operations: [...history, ...month('2026-09-10', 0.22)] }))).toEqual([]);
    // +3,5 п.п., но на доле 40 % это ×1.09.
    const high = [
      ...month('2026-06-10', 0.4),
      ...month('2026-07-10', 0.4),
      ...month('2026-08-10', 0.4),
    ];
    expect(kinds(input({ operations: [...high, ...month('2026-09-10', 0.435)] }))).toEqual([]);
  });

  it('истории меньше минимума или выручка месяца мала — не судим', () => {
    expect(
      kinds(input({ operations: [...history.slice(0, 4), ...month('2026-09-10', 0.4)] })),
    ).toEqual([]);
    const tiny = [
      op({ day: '2026-09-10', amountKopecks: ANOMALY_THRESHOLDS.commission.minRevenueKopecks - 1 }),
      op({ day: '2026-09-10', article: 'commission', amountKopecks: -500_000 }),
    ];
    expect(kinds(input({ operations: [...history, ...tiny] }))).toEqual([]);
  });

  it('месяц старше окна истории не участвует', () => {
    const old = [...month('2026-01-10', 0.5), ...month('2026-02-10', 0.5)];
    // Без старых месяцев история — две точки, меньше минимума.
    expect(
      kinds(input({ operations: [...old, ...history.slice(0, 4), ...month('2026-09-10', 0.3)] })),
    ).toEqual([]);
  });
});

describe('двойные начисления', () => {
  const service = (over: Partial<IPnlOperation> & { day?: string } = {}) =>
    op({
      article: 'delivery_to_buyer',
      amountKopecks: -15_000,
      transactionType: 'Удержание',
      serviceName: 'Доставка покупателю',
      sku: null,
      count: null,
      ...over,
    });

  it('две одинаковые строки услуги по заказу в день — аномалия', () => {
    const found = detectAnomalies(input({ operations: [service(), service()] }));
    expect(found.map((a) => a.kind)).toEqual(['duplicate_accrual']);
    expect(found[0]).toMatchObject({ orderId: '100', operationCount: 2, amountKopecks: -30_000 });
  });

  it('разный день, сумма или заказ — не дубль; одна строка — не дубль', () => {
    expect(kinds(input({ operations: [service(), service({ day: '2026-09-11' })] }))).toEqual([]);
    expect(kinds(input({ operations: [service(), service({ amountKopecks: -16_000 })] }))).toEqual(
      [],
    );
    expect(kinds(input({ operations: [service(), service({ orderId: '101' })] }))).toEqual([]);
    expect(kinds(input({ operations: [service()] }))).toEqual([]);
  });

  it('продажи не судятся: две строки — две штуки', () => {
    expect(kinds(input({ operations: [op(), op()] }))).toEqual([]);
  });

  it('услуга за штуку: строк не больше, чем штук артикула в заказе, — не дубль', () => {
    const perUnit = { sku: 'A1' };
    const sale = op({ count: '2' });
    expect(kinds(input({ operations: [sale, service(perUnit), service(perUnit)] }))).toEqual([]);
    expect(
      kinds(input({ operations: [sale, service(perUnit), service(perUnit), service(perUnit)] })),
    ).toEqual(['duplicate_accrual']);
  });
});

describe('нетипичная логистика на товар', () => {
  const typical = ['B', 'C', 'D', 'E'].map((sku) => ({ sku, units: 10, logistics: -10_000 * 10 }));

  it('×3 к медиане и +150 ₽/шт — аномалия, ссылки — логистика товара и его заказов', () => {
    const operations = [
      op({ sku: 'A', orderId: '7' }),
      op({ article: 'delivery_to_buyer', sku: null, orderId: '7', amountKopecks: -100_000 }),
      op({ article: 'delivery_to_buyer', sku: null, orderId: '8', amountKopecks: -100_000 }),
    ];
    const found = detectAnomalies(
      input({ operations, skus: [...typical, { sku: 'A', units: 2, logistics: -100_000 }] }),
    );
    expect(found.map((a) => a.kind)).toEqual(['logistics_outlier']);
    expect(found[0]).toMatchObject({ sku: 'A', operationCount: 1, amountKopecks: -100_000 });
    expect(found[0].detail).toContain('500,00 ₽');
  });

  it('дорого, но меньше 150 ₽ сверху — тишина; товаров меньше минимума — тишина', () => {
    const cheap = typical.map((s) => ({ ...s, logistics: -1_000 * 10 }));
    expect(kinds(input({ skus: [...cheap, { sku: 'A', units: 1, logistics: -5_000 }] }))).toEqual(
      [],
    );
    expect(
      kinds(input({ skus: [...typical.slice(0, 3), { sku: 'A', units: 1, logistics: -100_000 }] })),
    ).toEqual([]);
  });
});

describe('штрафы и нераспознанное', () => {
  it('штрафы — по подписи, любая сумма', () => {
    const fine = (amount: number, serviceName = 'Штраф за опоздание') =>
      op({
        article: 'penalties',
        amountKopecks: amount,
        transactionType: 'Удержание',
        serviceName,
      });
    const found = detectAnomalies(
      input({ operations: [fine(-100), fine(-200), fine(-300, 'Штраф за отмену')] }),
    );
    expect(found.map((a) => [a.kind, a.operationCount, a.amountKopecks])).toEqual([
      ['penalty', 2, -300],
      ['penalty', 1, -300],
    ]);
  });

  it('unknown — по подписи; штрафов и unknown нет — тишина', () => {
    const odd = op({ article: 'unknown', amountKopecks: -777, serviceName: 'Новая услуга' });
    const found = detectAnomalies(input({ operations: [odd] }));
    expect(found.map((a) => a.kind)).toEqual(['unknown_article']);
    expect(found[0].detail).toContain('Новая услуга');
    expect(kinds(input({ operations: [op()] }))).toEqual([]);
  });

  it('строки вне месяца не судятся', () => {
    const fine = op({ day: '2026-08-31', article: 'penalties', amountKopecks: -100 });
    expect(kinds(input({ operations: [fine] }))).toEqual([]);
  });
});

describe('сверка и закуп', () => {
  const finding = (over: Partial<IReconcileFinding>): IReconcileFinding => ({
    kind: 'accrual_without_order',
    orderId: '55',
    operationIds: ['x'],
    operationCount: 1,
    detail: 'Заказа 55 нет',
    ...over,
  });

  it('находки сверки — аномалии, кроме unknown_article (его ловит свой детектор)', () => {
    const found = detectAnomalies(
      input({
        discrepancies: [finding({}), finding({ kind: 'unknown_article', orderId: undefined })],
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'reconcile',
      key: `reconcile:${SEPT_KEY}:accrual_without_order:55:`,
      orderId: '55',
      detail: 'Заказа 55 нет',
    });
  });

  it('нет закупа — по артикулу; без артикула — своя строка', () => {
    const found = detectAnomalies(
      input({
        unknown: [
          { sku: 'Z9', count: 3, operationIds: ['a', 'b'] },
          { sku: '', count: 1, operationIds: ['c'] },
        ],
      }),
    );
    expect(found.map((a) => [a.kind, a.sku])).toEqual([
      ['missing_cost', null],
      ['missing_cost', 'Z9'],
    ]);
  });
});

describe('ключи, отпечатки, порядок', () => {
  it('порядок строк не меняет ни ключей, ни результата', () => {
    const fines = [1, 2, 3].map((i) =>
      op({ article: 'penalties', amountKopecks: -i, serviceName: `Штраф ${i % 2}` }),
    );
    const a = detectAnomalies(input({ operations: fines }));
    const b = detectAnomalies(input({ operations: [...fines].reverse() }));
    expect(b).toEqual(a);
  });

  it('новый штраф того же вида — тот же ключ, другой отпечаток', () => {
    const fine = (day: string) =>
      op({ day, article: 'penalties', amountKopecks: -100, serviceName: 'Штраф' });
    const [one] = detectAnomalies(input({ operations: [fine('2026-09-10')] }));
    const [two] = detectAnomalies(input({ operations: [fine('2026-09-10'), fine('2026-09-11')] }));
    expect(two.key).toBe(one.key);
    expect(two.fingerprint).not.toBe(one.fingerprint);
  });

  it('ссылок не больше потолка, счётчик — полный', () => {
    const fines = Array.from({ length: MAX_FINDING_OPERATION_REFS + 5 }, () =>
      op({ article: 'penalties', amountKopecks: -1, serviceName: 'Штраф' }),
    );
    const [found] = detectAnomalies(input({ operations: fines }));
    expect(found.operationIds).toHaveLength(MAX_FINDING_OPERATION_REFS);
    expect(found.operationCount).toBe(MAX_FINDING_OPERATION_REFS + 5);
  });

  it('виды идут в порядке ANOMALY_KINDS', () => {
    const found = detectAnomalies(
      input({
        operations: [
          op({ article: 'unknown', amountKopecks: -1 }),
          op({ article: 'penalties', amountKopecks: -1 }),
        ],
        unknown: [{ sku: 'Z', count: 1, operationIds: [] }],
      }),
    );
    expect(found.map((a) => a.kind)).toEqual(['penalty', 'unknown_article', 'missing_cost']);
  });
});
