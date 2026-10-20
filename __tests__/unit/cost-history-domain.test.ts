import { describe, expect, it } from 'vitest';

import {
  costAt,
  costDayOf,
  costOn,
  costsOn,
  datedCosts,
  historyWrites,
  manualWrites,
  samePurchase,
  type ICostRecord,
} from '../../src/modules/products/cost-history.domain';
import {
  applyDiscounts,
  DEFAULT_RATES,
  discountsOf,
  profitOf,
} from '../../src/modules/yandex/reports/profit';

const OLD: ICostRecord = { validFrom: null, price: 1000, currency: 'RUR', source: 'baseline' };
const NEW: ICostRecord = { validFrom: '2026-10-16', price: 1200, currency: 'RUR' };

describe('costDayOf: день по Москве', () => {
  it('момент — московский день, а не UTC', () => {
    // 15-10 21:30 UTC — это уже 16-10 00:30 по Москве.
    expect(costDayOf(new Date('2026-10-15T21:30:00Z'))).toBe('2026-10-16');
    expect(costDayOf(new Date('2026-10-15T20:59:00Z'))).toBe('2026-10-15');
  });

  it('даты заказа Маркета во всех формах', () => {
    expect(costDayOf('15-10-2026 23:59:00')).toBe('2026-10-15');
    expect(costDayOf('2026-10-16')).toBe('2026-10-16');
    expect(costDayOf('2026-10-15T21:30:00Z')).toBe('2026-10-16');
  });

  it('мусор и пустота — null', () => {
    expect(costDayOf('вчера')).toBeNull();
    expect(costDayOf(undefined)).toBeNull();
    expect(costDayOf(new Date('nope'))).toBeNull();
  });
});

describe('costAt', () => {
  const history = [NEW, OLD];

  it('граница дня МСК: 23:59 15-го — старая цена, 00:01 16-го — новая', () => {
    expect(costAt({ history }, '15-10-2026 23:59:00')?.price).toBe(1000);
    expect(costAt({ history }, '16-10-2026 00:01:00')?.price).toBe(1200);
    // Тот же момент глазами UTC — ещё 15-е, но по Москве уже 16-е.
    expect(costAt({ history }, new Date('2026-10-15T21:01:00Z'))?.price).toBe(1200);
  });

  it('стартовая запись действует для любой прошлой даты', () => {
    expect(costAt({ history }, '01-01-2020 10:00:00')?.price).toBe(1000);
  });

  it('нет записи до даты продажи — null, а не текущая цена', () => {
    expect(costAt({ history: [NEW], current: { price: 999 } }, '15-10-2026 12:00:00')).toBeNull();
  });

  it('дата неизвестна — только стартовая запись', () => {
    expect(costAt({ history }, null)?.price).toBe(1000);
    expect(costAt({ history: [NEW] }, null)).toBeNull();
  });

  it('истории нет — текущий закуп: цена не менялась с выкатки', () => {
    expect(costAt({ history: [], current: { price: 777 } }, '15-10-2026 12:00:00')).toEqual({
      price: 777,
    });
    expect(costAt({}, '15-10-2026 12:00:00')).toBeNull();
  });
});

describe('samePurchase', () => {
  it('пустая валюта и RUB — те же рубли; доп. расходы 0 = нет', () => {
    expect(samePurchase({ price: 10 }, { price: 10, currency: 'RUR', extraCosts: 0 })).toBe(true);
    expect(samePurchase({ price: 10, currency: 'RUB' }, { price: 10, currency: 'RUR' })).toBe(true);
    expect(samePurchase({ price: 10 }, { price: 11 })).toBe(false);
    expect(
      samePurchase(
        { price: 10, currency: 'USD', rate: 90 },
        { price: 10, currency: 'USD', rate: 95 },
      ),
    ).toBe(false);
  });
});

describe('historyWrites: только изменения', () => {
  const productIds = new Map([['A1', 'p1']]);
  const TODAY = '2026-10-16';

  it('тот же прайс второй раз — ноль записей', () => {
    const histories = new Map([['p1', [OLD]]]);
    const rows = [{ sku: 'A1', price: 1000 }];
    expect(historyWrites(rows, { productIds, histories, previous: new Map() }, TODAY)).toEqual([]);
  });

  it('истории нет, цена та же — ничего: текущий закуп и есть стартовая запись', () => {
    const rows = [{ sku: 'A1', price: 1000 }];
    const previous = new Map([['A1', { price: 1000 }]]);
    expect(historyWrites(rows, { productIds, histories: new Map(), previous }, TODAY)).toEqual([]);
  });

  it('истории нет, цена другая — стартовая со СТАРОЙ ценой плюс запись дня', () => {
    const rows = [{ sku: 'A1', price: 1200 }];
    const previous = new Map([['A1', { price: 1000 }]]);
    expect(historyWrites(rows, { productIds, histories: new Map(), previous }, TODAY)).toEqual([
      {
        productId: 'p1',
        validFrom: null,
        purchase: { price: 1000, currency: 'RUR' },
        source: 'baseline',
      },
      {
        productId: 'p1',
        validFrom: TODAY,
        purchase: { price: 1200, currency: 'RUR' },
        source: 'price-list',
      },
    ]);
  });

  it('новый артикул — стартовая: первая известная цена чинит прошлые заказы', () => {
    const rows = [{ sku: 'A1', price: 500 }];
    expect(
      historyWrites(rows, { productIds, histories: new Map(), previous: new Map() }, TODAY),
    ).toEqual([
      {
        productId: 'p1',
        validFrom: null,
        purchase: { price: 500, currency: 'RUR' },
        source: 'baseline',
      },
    ]);
  });

  it('история есть, цена сменилась — запись дня', () => {
    const histories = new Map([['p1', [OLD]]]);
    const rows = [{ sku: 'A1', price: 1300 }];
    expect(historyWrites(rows, { productIds, histories, previous: new Map() }, TODAY)).toEqual([
      {
        productId: 'p1',
        validFrom: TODAY,
        purchase: { price: 1300, currency: 'RUR' },
        source: 'price-list',
      },
    ]);
  });

  it('товара нет — писать некуда', () => {
    const rows = [{ sku: 'ZZ', price: 1 }];
    expect(
      historyWrites(rows, { productIds, histories: new Map(), previous: new Map() }, TODAY),
    ).toEqual([]);
  });
});

describe('datedCosts: «Прибыль» на дату заказа', () => {
  const rows = new Map([['A1', { price: 1200, name: 'Casio A1', category: 'CASIO' }]]);
  const order = (creationDate: string) => ({
    id: 1,
    creationDate,
    itemsTotal: 3000,
    items: [{ offerId: 'A1', count: 1, price: 3000 }],
  });

  it('заказ до смены цены — по старой, после — по новой', () => {
    const costOf = datedCosts(rows, new Map([['A1', [NEW, OLD]]]), DEFAULT_RATES);
    const before = profitOf([order('15-10-2026 23:59:00')], costOf, DEFAULT_RATES);
    const after = profitOf([order('16-10-2026 00:01:00')], costOf, DEFAULT_RATES);
    // Скидка по умолчанию 10 %.
    expect(before.purchase).toBeCloseTo(900);
    expect(after.purchase).toBeCloseTo(1080);
  });

  it('без истории — до рубля прежний applyDiscounts', () => {
    const costOf = datedCosts(rows, new Map(), DEFAULT_RATES);
    const legacy = applyDiscounts(rows, DEFAULT_RATES);
    const orders = [order('01-07-2026 10:00:00')];
    expect(profitOf(orders, costOf, DEFAULT_RATES)).toEqual(
      profitOf(orders, legacy, DEFAULT_RATES),
    );
  });

  it('нет записи до даты заказа — заказ исключён, артикул в «нет закупа»', () => {
    const costOf = datedCosts(rows, new Map([['A1', [NEW]]]), DEFAULT_RATES);
    const totals = profitOf([order('15-10-2026 12:00:00')], costOf, DEFAULT_RATES);
    expect(totals.orders).toBe(0);
    expect(totals.unconfirmed.orders).toBe(1);
    expect(totals.unconfirmed.skus).toEqual(['A1']);
  });
});

describe('costOn: одна себестоимость на «Прибыль», «Прайс» и «Товары» (TASK-118)', () => {
  const config = discountsOf(DEFAULT_RATES);
  const manual: ICostRecord = {
    validFrom: '2026-10-17',
    price: 10,
    currency: 'USD',
    rate: 90,
    extraCosts: 50,
    source: 'manual',
  };

  it('без истории — текущий закуп со скидкой, ровно как applyDiscounts', () => {
    const row = { price: 1000, name: 'Часы', category: 'CASIO' };
    const legacy = applyDiscounts(new Map([['A1', row]]), DEFAULT_RATES).get('A1');
    expect(costOn({ ...row, current: { price: row.price } }, config, '2026-10-17')).toBe(legacy);
  });

  it('ручная запись в валюте: курс × цена − скидка + доп. расходы, с её дня', () => {
    const history = [OLD, manual];
    const source = { name: 'Часы', category: 'CASIO', history, current: { price: 1000 } };
    const before = costOn(source, config, '2026-10-16');
    const after = costOn(source, config, '2026-10-17');
    expect(before).toBe(costOn({ ...source, history: [OLD] }, config, '2026-10-16'));
    expect(after).toBe(
      costOn({ ...source, history: [{ ...manual, extraCosts: 0 }] }, config, '2026-10-17')! + 50,
    );
  });

  it('«Прайс» (costsOn) и «Прибыль» (datedCosts) дают одно число на день', () => {
    const rows = new Map([['A1', { price: 1000, name: 'Часы', category: 'CASIO' }]]);
    const histories = new Map([['A1', [OLD, manual]]]);
    const price = costsOn(rows, histories, DEFAULT_RATES, '2026-10-17').get('A1');
    const profit = datedCosts(
      rows,
      histories,
      DEFAULT_RATES,
    )('A1', {
      creationDate: '17-10-2026 12:00:00',
    } as never);
    expect(price).toBe(profit);
  });

  it('валюта без курса — null, а не ноль', () => {
    const source = { current: { price: 10, currency: 'USD' } };
    expect(costOn(source, config, '2026-10-17')).toBeNull();
  });
});

describe('manualWrites: ручная правка закупа', () => {
  const next = { price: 10, currency: 'USD', rate: 90 };

  it('истории нет, закуп был — стартовая со СТАРЫМ закупом плюс запись дня', () => {
    expect(manualWrites({ current: { price: 1000, currency: 'RUR' } }, next, '2026-10-17')).toEqual(
      [
        { validFrom: null, purchase: { price: 1000, currency: 'RUR' }, source: 'baseline' },
        { validFrom: '2026-10-17', purchase: next, source: 'manual' },
      ],
    );
  });

  it('истории и закупа нет — ручная цена становится стартовой', () => {
    expect(manualWrites({ current: null }, next, '2026-10-17')).toEqual([
      { validFrom: null, purchase: next, source: 'baseline' },
    ]);
  });

  it('история есть — запись дня; совпадает с действующей — ничего', () => {
    expect(manualWrites({ history: [OLD] }, next, '2026-10-17')).toEqual([
      { validFrom: '2026-10-17', purchase: next, source: 'manual' },
    ]);
    expect(
      manualWrites({ history: [OLD] }, { price: 1000, currency: 'RUR' }, '2026-10-17'),
    ).toEqual([]);
  });
});

describe('historyWrites после ручной правки (product_manual_vs_price_list)', () => {
  const manual: ICostRecord = {
    validFrom: '2026-10-15',
    price: 10,
    currency: 'USD',
    rate: 90,
    extraCosts: 50,
    source: 'manual',
  };
  const context = (previousPrice: number) => ({
    productIds: new Map([['A1', 'p1']]),
    histories: new Map([['p1', [OLD, manual]]]),
    previous: new Map([['A1', { price: previousPrice }]]),
  });

  it('файл с той же ценой, что прошлый, ручную запись не трогает', () => {
    expect(historyWrites([{ sku: 'A1', price: 1000 }], context(1000), '2026-10-17')).toEqual([]);
  });

  it('новая цена в файле — запись в рублях с доп. расходами ручной записи', () => {
    expect(historyWrites([{ sku: 'A1', price: 1100 }], context(1000), '2026-10-17')).toEqual([
      {
        productId: 'p1',
        validFrom: '2026-10-17',
        purchase: { price: 1100, currency: 'RUR', extraCosts: 50 },
        source: 'price-list',
      },
    ]);
  });
});
