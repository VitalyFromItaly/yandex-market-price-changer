import { describe, expect, it, vi } from 'vitest';

import { expandBreakdown } from '../../src/modules/finance/operation-breakdown';
import { pnlLineOf } from '../../src/modules/finance/pnl';
import {
  WB_GOODS_OPERS,
  WB_KNOWN_OPERS,
  wbGoodsMovement,
  wbOperArticle,
} from '../../src/modules/finance/wb-articles';
import {
  WB_UNKNOWN_ARTICLE_CONTEXT,
  reportWbUnknownArticles,
  wbFinanceOriginal,
  wbOperationKey,
  wbPayoutByReport,
  wbRowAmount,
  wbRowParts,
  wbRowToOperation,
  wbRowsInPeriod,
} from '../../src/modules/finance/wb-journal';

/**
 * Журнал отчёта реализации WB (TASK-136): классификатор на каждый тип строки,
 * сумма строки = её вклад в «к перечислению», части сходятся с суммой.
 * Поля строки — по памяти (доки WB автоматике не отдаются, known-gaps).
 */

const CTX = {
  telegramUserId: '111',
  businessId: 'sid-1',
  documentId: '00000000-0000-0000-0000-000000000001',
  documentVersion: 1,
  periodKey: 'wb-realization-report:2026-09-01:2026-09-30',
};

const EMPTY_MONEY = {
  retail_price_withdisc_rub: 0,
  acquiring_fee: 0,
  ppvz_for_pay: 0,
  delivery_rub: 0,
  return_amount: 0,
  delivery_amount: 0,
  storage_fee: 0,
  penalty: 0,
  deduction: 0,
  acceptance: 0,
  additional_payment: 0,
};

const row = (over: Record<string, unknown> = {}) => ({
  rrd_id: 1001,
  realizationreport_id: 555,
  rr_dt: '2026-09-16',
  supplier_oper_name: 'Продажа',
  doc_type_name: 'Продажа',
  sa_name: 'VC-1',
  nm_id: 777,
  srid: 'srid-1',
  quantity: 1,
  ...EMPTY_MONEY,
  retail_price_withdisc_rub: 2000,
  acquiring_fee: 30,
  ppvz_for_pay: 1600,
  ...over,
});

/** Строка без товара: только своя денежная колонка. */
const service = (oper: string, money: Record<string, unknown>, over = {}) =>
  row({
    supplier_oper_name: oper,
    doc_type_name: '',
    quantity: 0,
    ...EMPTY_MONEY,
    ...money,
    ...over,
  });

describe('wb-articles', () => {
  it('каждый известный тип — своя статья, незнакомый — unknown', () => {
    for (const oper of WB_KNOWN_OPERS) {
      if (WB_GOODS_OPERS.has(oper)) continue;
      expect(wbOperArticle(oper), oper).not.toBe('unknown');
    }
    expect(wbOperArticle('Новая услуга WB')).toBe('unknown');
  });

  it('товар двигает только часть выручки товарной строки', () => {
    expect(wbGoodsMovement('Продажа', 'sales')).toBe('sold');
    expect(wbGoodsMovement('Возврат', 'returns')).toBe('returned');
    expect(wbGoodsMovement('Продажа', 'commission')).toBeNull();
    expect(wbGoodsMovement('Компенсация ущерба', 'compensations')).toBeNull();
  });
});

describe('wbRowParts — тест на каждый тип строки', () => {
  it('Продажа: выручка, эквайринг, комиссия — остатком до ppvz_for_pay', () => {
    const parts = wbRowParts(row());
    expect(parts).toEqual([
      { article: 'sales', kopecks: 200000, sheet: 'retail_price_withdisc_rub' },
      { article: 'acquiring', kopecks: -3000, sheet: 'acquiring_fee' },
      { article: 'commission', kopecks: -37000, sheet: 'ppvz_for_pay' },
    ]);
    expect(wbRowAmount(row())).toBe(160000);
  });

  it('Возврат: те же колонки со знаком минус', () => {
    const parts = wbRowParts(row({ supplier_oper_name: 'Возврат', doc_type_name: 'Возврат' }));
    expect(parts.map((p) => [p.article, p.kopecks])).toEqual([
      ['returns', -200000],
      ['acquiring', 3000],
      ['commission', 37000],
    ]);
  });

  it.each([
    ['Корректная продажа', 'Продажа', 'sales'],
    ['Корректный возврат', 'Возврат', 'returns'],
    ['Сторно продаж', 'Возврат', 'returns'],
    ['Сторно возвратов', 'Продажа', 'sales'],
    ['Коррекция продаж', 'Продажа', 'sales'],
  ])('%s — товарная строка, выручка статьёй %s', (oper, docType, article) => {
    const op = wbRowToOperation(row({ supplier_oper_name: oper, doc_type_name: docType }), CTX);
    expect(op.article).toBe(article);
    expect(op.breakdown?.[0].article).toBe(article);
  });

  it('Логистика: к покупателю, при возврате — обратная', () => {
    expect(wbRowParts(service('Логистика', { delivery_rub: 80, delivery_amount: 1 }))).toEqual([
      { article: 'delivery_to_buyer', kopecks: -8000, sheet: 'delivery_rub' },
    ]);
    expect(
      wbRowParts(service('Логистика', { delivery_rub: 80, return_amount: 1 }))[0].article,
    ).toBe('reverse_logistics');
  });

  it.each([
    ['Логистика сторно', { delivery_rub: -80 }, 'delivery_to_buyer', 8000],
    ['Коррекция логистики', { delivery_rub: 10 }, 'delivery_to_buyer', -1000],
    ['Возмещение издержек по перевозке', { delivery_rub: 5 }, 'delivery_to_buyer', -500],
    [
      'Возмещение издержек по перевозке/по складским операциям с товаром',
      { delivery_rub: 5 },
      'delivery_to_buyer',
      -500,
    ],
    ['Хранение', { storage_fee: 12.5 }, 'storage', -1250],
    ['Штраф', { penalty: 300 }, 'penalties', -30000],
    ['Штрафы', { penalty: 300 }, 'penalties', -30000],
    ['Удержание', { deduction: 1000 }, 'withholdings', -100000],
    ['Удержания', { deduction: 1000 }, 'withholdings', -100000],
    ['Платная приемка', { acceptance: 40 }, 'acceptance', -4000],
    ['Платная приёмка', { acceptance: 40 }, 'acceptance', -4000],
    ['Компенсация ущерба', { ppvz_for_pay: 1500 }, 'compensations', 150000],
    ['Частичная компенсация брака', { ppvz_for_pay: 200 }, 'compensations', 20000],
    ['Добровольная компенсация при возврате', { ppvz_for_pay: 100 }, 'compensations', 10000],
    ['Компенсация подмененного товара', { ppvz_for_pay: 900 }, 'compensations', 90000],
    ['Авансовая оплата за товар без движения', { ppvz_for_pay: 700 }, 'compensations', 70000],
    [
      'Возмещение за выдачу и возврат товаров на ПВЗ',
      { additional_payment: 15 },
      'compensations',
      1500,
    ],
    [
      'Компенсация скидки по программе лояльности',
      { additional_payment: 20 },
      'compensations',
      2000,
    ],
  ])('%s → %s', (oper, money, article, kopecks) => {
    const op = wbRowToOperation(service(oper, money), CTX);
    expect(op.article).toBe(article);
    expect(op.amountKopecks).toBe(kopecks);
    expect(op.breakdown).toBeUndefined();
  });

  it('все известные типы покрыты тестами выше', () => {
    // Список пиннится: новый тип без строки в it.each заставит дописать тест.
    expect(WB_KNOWN_OPERS).toHaveLength(26);
  });

  it('незнакомый тип — вся сумма одной частью unknown', () => {
    const op = wbRowToOperation(
      service('Новая услуга WB', { deduction: 50, storage_fee: 10 }),
      CTX,
    );
    expect(op.article).toBe('unknown');
    expect(op.amountKopecks).toBe(-6000);
    expect(op.breakdown).toBeUndefined();
  });

  it('Σ частей = сумме строки, даже со смешанными колонками', () => {
    const mixed = row({ delivery_rub: 70, storage_fee: 3.33, additional_payment: 1.11 });
    const op = wbRowToOperation(mixed, CTX);
    expect(op.breakdown?.reduce((s, p) => s + p.kopecks, 0)).toBe(op.amountKopecks);
    expect(op.amountKopecks).toBe(160000 - 7000 - 333 + 111);
  });
});

describe('wbRowToOperation', () => {
  it('поля строки: заказ, артикул через ключ закупа, тип, источник, дата по Москве', () => {
    const op = wbRowToOperation(row(), CTX, (vc) => (vc === 'VC-1' ? 'A1' : undefined));
    expect(op).toMatchObject({
      marketplace: 'wb',
      article: 'sales',
      direction: 'income',
      orderId: 'srid-1',
      sku: 'A1',
      transactionType: 'Продажа',
      transactionSource: 'Продажа',
      businessId: 'sid-1',
    });
    expect(op.accruedAt.toISOString()).toBe('2026-09-15T21:00:00.000Z');
    // Товар без привязки — артикул продавца.
    expect(wbRowToOperation(row(), CTX).sku).toBe('VC-1');
  });

  it('ключ — rrd_id и сумма: тот же — тот же ключ, пересчёт — другой', () => {
    const a = wbRowToOperation(row(), CTX).operationKey;
    expect(wbRowToOperation(row(), CTX).operationKey).toBe(a);
    expect(a).toBe(wbOperationKey('1001', 160000));
    expect(wbRowToOperation(row({ ppvz_for_pay: 1590 }), CTX).operationKey).not.toBe(a);
  });

  it('без rrd_id или даты — бросает', () => {
    expect(() => wbRowToOperation(row({ rrd_id: null }), CTX)).toThrow(/rrd_id/);
    expect(() => wbRowToOperation(row({ rr_dt: 'мусор' }), CTX)).toThrow(/rr_dt/);
  });

  it('P&L: товар и штуки — только у части выручки', () => {
    const op = wbRowToOperation(row(), CTX);
    const lines = expandBreakdown([
      {
        id: 'op-1',
        article: op.article,
        amountKopecks: op.amountKopecks,
        orderId: op.orderId,
        sku: op.sku,
        transactionType: op.transactionType,
        transactionSource: op.transactionSource ?? null,
        accruedAt: op.accruedAt,
        paidAt: null,
        model: null,
        count: '1',
        marketplace: 'wb' as const,
        breakdown: op.breakdown,
      },
    ]).map(pnlLineOf);
    expect(lines.map((l) => [l.article, l.goods])).toEqual([
      ['sales', 'sold'],
      ['acquiring', null],
      ['commission', null],
    ]);
  });
});

describe('период, оригинал, к перечислению', () => {
  const SEPT = { from: '2026-09-01', to: '2026-09-30' };

  it('в месяц — строки с днём rr_dt по Москве внутри', () => {
    const { rows, dropped } = wbRowsInPeriod(
      [row(), row({ rrd_id: 2, rr_dt: '2026-08-31' }), row({ rrd_id: 3, rr_dt: '2026-10-01' })],
      SEPT,
    );
    expect(rows).toHaveLength(1);
    expect(dropped).toBe(2);
  });

  it('байты оригинала не зависят от порядка строк и ключей', () => {
    const a = [row({ rrd_id: 2 }), row({ rrd_id: 10 })];
    // Тот же набор в обратном порядке и с ключами объектов в обратном порядке.
    const flip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());
    const b = [flip(row({ rrd_id: 10 })), flip(row({ rrd_id: 2 }))];
    expect(wbFinanceOriginal(SEPT, a).equals(wbFinanceOriginal(SEPT, b))).toBe(true);
    // Ключи закупа — часть байтов: привязали товар — новая версия.
    expect(wbFinanceOriginal(SEPT, a, () => 'A1').equals(wbFinanceOriginal(SEPT, a))).toBe(false);
  });

  it('Σ сумм строк недельного отчёта = к перечислению', () => {
    const week = [
      row({ rrd_id: 1 }),
      row({
        rrd_id: 2,
        supplier_oper_name: 'Возврат',
        doc_type_name: 'Возврат',
        ppvz_for_pay: 800,
        retail_price_withdisc_rub: 1000,
        acquiring_fee: 15,
      }),
      service('Логистика', { delivery_rub: 75 }, { rrd_id: 3 }),
      service('Хранение', { storage_fee: 20 }, { rrd_id: 4 }),
      service('Штраф', { penalty: 100 }, { rrd_id: 5 }),
      service('Удержание', { deduction: 50 }, { rrd_id: 6 }),
      service('Платная приемка', { acceptance: 10 }, { rrd_id: 7 }),
      service('Компенсация ущерба', { ppvz_for_pay: 500 }, { rrd_id: 8 }),
      row({ rrd_id: 9, realizationreport_id: 556 }),
    ];
    // 1600 − 800 − 75 − 20 − 100 − 50 − 10 + 500 = 1045 ₽.
    expect(wbPayoutByReport(week)).toEqual(
      new Map([
        ['555', 104500],
        ['556', 160000],
      ]),
    );
  });

  it('нераспознанное — один алерт с типом строки', async () => {
    const report = vi.fn(async () => undefined);
    const ops = [
      wbRowToOperation(service('Новая услуга WB', { deduction: 5 }), CTX),
      wbRowToOperation(row(), CTX),
    ];
    expect(await reportWbUnknownArticles({ report }, ops, '111')).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: WB_UNKNOWN_ARTICLE_CONTEXT }),
    );
    expect(String((report.mock.calls[0] as any[])[0].error.message)).toContain('Новая услуга WB');
  });
});
