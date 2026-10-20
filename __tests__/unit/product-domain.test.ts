import { describe, it, expect } from 'vitest';

import {
  isMarketplace,
  matchCards,
  productCost,
  ozonCatalogRows,
  productRowsFromCatalog,
  productRowsFromPriceList,
  summarizeMatches,
  type IMatchableProduct,
} from '../../src/modules/products/product.domain';
import {
  applyDiscounts,
  DEFAULT_RATES,
  discountsOf,
} from '../../src/modules/yandex/reports/profit';

/**
 * Себестоимость товара и строки для записи в базу товаров.
 *
 * Главное здесь — что правило скидки бренда ОДНО: `productCost` в рублях без
 * доп. расходов обязан давать ровно то, что «Прибыль» получает через
 * `applyDiscounts`. Разойтись им значило бы показать продавцу две
 * себестоимости одного товара.
 */
describe('productCost', () => {
  const config = discountsOf(DEFAULT_RATES);

  it('в рублях совпадает с applyDiscounts «Прибыли» — второй копии правила нет', () => {
    const rows = [
      { sku: 'V1', price: 10000, name: 'Восток Амфибия 420' },
      { sku: 'C1', price: 10000, category: 'CASIO COLLECTION' },
      { sku: 'K1', price: 10000, name: 'Восток Кремлёвские' },
      { sku: 'N1', price: 777, name: 'Без бренда' },
    ];
    const rates = { ...DEFAULT_RATES, brandDiscounts: { casio: 15 } };
    const costs = applyDiscounts(new Map(rows.map((r) => [r.sku, r])), rates);

    for (const row of rows) {
      const cost = productCost({ ...row, purchase: { price: row.price } }, discountsOf(rates));
      expect(cost).toBe(costs.get(row.sku));
    }
    // И числа те, что ожидает владелец: Восток 4 %, Casio по карте 15 %,
    // «Кремлёвские» — исключение из Востока, дефолт 10 %.
    expect(costs.get('V1')).toBe(9600);
    expect(costs.get('C1')).toBe(8500);
    expect(costs.get('K1')).toBe(9000);
  });

  it('закуп × курс − скидка бренда + доп. расходы; расходы скидкой не уменьшаются', () => {
    const cost = productCost(
      {
        category: 'ORIENT',
        purchase: { price: 100, currency: 'USD', rate: 90, extraCosts: 500 },
      },
      config,
    );
    // 100 × 90 = 9000, минус 10 % = 8100, плюс 500 доставки.
    expect(cost).toBe(8600);
  });

  it('RUR и RUB — рубли, курс не нужен и не применяется', () => {
    expect(productCost({ purchase: { price: 1000, currency: 'RUR', rate: 90 } }, config)).toBe(900);
    expect(productCost({ purchase: { price: 1000, currency: 'rub' } }, config)).toBe(900);
  });

  it('неизвестна — null, а не ноль', () => {
    // Нет закупа: товар каталога без строки прайса.
    expect(productCost({ name: 'Casio' }, config)).toBeNull();
    // Валюта без курса: рубли из долларов не выдумываются.
    expect(productCost({ purchase: { price: 100, currency: 'USD' } }, config)).toBeNull();
    expect(productCost({ purchase: { price: 100, currency: 'USD', rate: 0 } }, config)).toBeNull();
    // Мусор вместо цены.
    expect(productCost({ purchase: { price: Number.NaN } }, config)).toBeNull();
  });

  it('мусор в доп. расходах не ломает расчёт', () => {
    expect(productCost({ purchase: { price: 1000, extraCosts: 'x' as never } }, config)).toBe(900);
  });
});

describe('строки для записи в товары', () => {
  it('прайс: без артикула и цены — мимо, повтор артикула — последняя строка', () => {
    const rows = productRowsFromPriceList([
      { sku: ' A1 ', price: 100, name: 'старое' },
      { sku: 'A1', price: 120, name: 'новое' },
      { sku: '', price: 50 },
      { sku: 'B1', price: Number.NaN },
      { sku: 'C1', price: 0 },
    ]);

    expect(rows).toEqual([
      { sku: 'A1', price: 120, name: 'новое', category: undefined },
      { sku: 'C1', price: 0, name: undefined, category: undefined },
    ]);
  });

  it('каталог: цена продажи — только рублёвая', () => {
    const rows = productRowsFromCatalog([
      { offerId: 'A1', barcodes: ['1'], basicPrice: 1000, currencyId: 'RUR' },
      { offerId: 'B1', barcodes: [], basicPrice: 50, currencyId: 'USD' },
      { offerId: 'C1', barcodes: [], basicPrice: 70 },
    ]);

    expect(rows.map((r) => [r.sku, r.salePrice])).toEqual([
      ['A1', 1000],
      ['B1', undefined],
      ['C1', 70],
    ]);
  });
});

describe('matchCards: сопоставление карточек площадок с товарами (TASK-117)', () => {
  const ym = { marketplace: 'ym' as const, createMissing: true };
  const free = (id: string, extra: Partial<IMatchableProduct> = {}): IMatchableProduct => ({
    id,
    internalSku: `sku-${id}`,
    ...extra,
  });

  it('уже привязанная карточка — linked, кандидатов не ищем', () => {
    const [result] = matchCards(
      [{ sku: 'A1', barcodes: ['111'] }],
      [
        { id: 'p1', internalSku: 'X', marketplaceSkus: { ym: 'A1' } },
        free('p2', { barcodes: ['111'] }),
      ],
      ym,
    );
    expect(result.match).toEqual({ kind: 'linked', productId: 'p1' });
  });

  it('штрихкод — первый уровень', () => {
    const [result] = matchCards(
      [{ sku: 'C1', barcodes: [' 4600 '], vendorCode: 'V' }],
      [free('p1', { barcodes: ['4600'] }), free('p2', { vendorCode: 'V' })],
      ym,
    );
    expect(result.match).toEqual({ kind: 'matched', productId: 'p1', level: 'barcode' });
  });

  it('артикул производителя — без учёта регистра и пробелов по краям', () => {
    const [result] = matchCards(
      [{ sku: 'C1', vendorCode: ' ga-100 ', barcodes: [] }],
      [free('p1', { vendorCode: 'GA-100' })],
      ym,
    );
    expect(result.match).toEqual({ kind: 'matched', productId: 'p1', level: 'vendorCode' });
  });

  it('артикул — через skuCandidates: бренд в названии карточки снимается', () => {
    const [result] = matchCards(
      [{ sku: 'DK-14081-4', name: 'Daniel Klein 14081-4', barcodes: [] }],
      [{ id: 'p1', internalSku: '14081-4' }],
      ym,
    );
    expect(result.match).toEqual({ kind: 'matched', productId: 'p1', level: 'sku' });
  });

  it('подстрока — не совпадение', () => {
    const [result] = matchCards(
      [{ sku: 'GA-100-1A', vendorCode: 'GA-100-1A', barcodes: ['46001'] }],
      [free('p1', { vendorCode: 'GA-100', barcodes: ['4600'] })],
      ym,
    );
    expect(result.match).toEqual({ kind: 'create' });
  });

  it.each([
    ['barcode', { barcodes: ['111'] }, [{ barcodes: ['111'] }, { barcodes: ['111'] }]],
    ['vendorCode', { vendorCode: 'V' }, [{ vendorCode: 'V' }, { vendorCode: 'v' }]],
  ] as const)('конфликт на уровне %s — в очередь с кандидатами', (level, card, products) => {
    const [result] = matchCards(
      [{ sku: 'C1', barcodes: [], ...card }],
      products.map((extra, i) => free(`p${i + 1}`, extra)),
      ym,
    );
    expect(result.match).toEqual({
      kind: 'issue',
      reason: 'conflict',
      level,
      candidateIds: ['p1', 'p2'],
    });
  });

  it('конфликт на уровне артикула', () => {
    const [result] = matchCards(
      [{ sku: 'Casio GA-1', name: 'GA-1', barcodes: [] }],
      [
        { id: 'p1', internalSku: 'GA-1' },
        { id: 'p2', internalSku: 'Casio GA-1' },
      ],
      ym,
    );
    expect(result.match).toMatchObject({ kind: 'issue', reason: 'conflict', level: 'sku' });
  });

  it('конфликт не спускается на слабый уровень, даже если там один кандидат', () => {
    const [result] = matchCards(
      [{ sku: 'C1', barcodes: ['111'], vendorCode: 'V' }],
      [free('p1', { barcodes: ['111'], vendorCode: 'V' }), free('p2', { barcodes: ['111'] })],
      ym,
    );
    expect(result.match).toMatchObject({ kind: 'issue', reason: 'conflict', level: 'barcode' });
  });

  it('товар с привязкой на площадке — не кандидат: карточка его не уводит', () => {
    const [result] = matchCards(
      [{ sku: 'C1', barcodes: ['111'] }],
      [{ id: 'p1', internalSku: 'X', barcodes: ['111'], marketplaceSkus: { ym: 'OTHER' } }],
      ym,
    );
    expect(result.match).toEqual({ kind: 'create' });
  });

  it('привязка на ДРУГОЙ площадке кандидатству не мешает', () => {
    const [result] = matchCards(
      [{ sku: 'OZ1', barcodes: ['111'] }],
      [{ id: 'p1', internalSku: 'A1', barcodes: ['111'], marketplaceSkus: { ym: 'A1' } }],
      { marketplace: 'ozon', createMissing: false },
    );
    expect(result.match).toEqual({ kind: 'matched', productId: 'p1', level: 'barcode' });
  });

  it('один товар нужен двум карточкам — в очередь обе, исход не зависит от порядка', () => {
    const cards = [
      { sku: 'C1', barcodes: ['111'] },
      { sku: 'C2', vendorCode: 'V', barcodes: [] },
    ];
    const products = [free('p1', { barcodes: ['111'], vendorCode: 'V' })];

    for (const order of [cards, [...cards].reverse()]) {
      const results = matchCards(order, products, ym);
      expect(results.map((r) => r.match.kind)).toEqual(['issue', 'issue']);
      expect(results.every((r) => r.match.kind === 'issue' && r.match.reason === 'shared')).toBe(
        true,
      );
    }
  });

  it('отвязанная руками карточка пропускается, даже если пара очевидна', () => {
    const [result] = matchCards(
      [{ sku: 'C1', barcodes: ['111'] }],
      [free('p1', { barcodes: ['111'] })],
      { ...ym, unlinked: new Set(['C1']) },
    );
    expect(result.match).toEqual({ kind: 'skipped' });
  });

  it('нет пары: ЯМ заводит товар, а Ozon/WB — в очередь', () => {
    const card = { sku: 'C1', barcodes: [] };
    expect(matchCards([card], [], ym)[0].match).toEqual({ kind: 'create' });
    expect(matchCards([card], [], { marketplace: 'wb', createMissing: false })[0].match).toEqual({
      kind: 'issue',
      reason: 'no_match',
      candidateIds: [],
    });
  });

  it('internalSku занят товаром, привязанным к другой карточке, — sku_taken, а не дубль', () => {
    const [result] = matchCards(
      [{ sku: 'C1', barcodes: [] }],
      [{ id: 'p1', internalSku: 'C1', marketplaceSkus: { ym: 'MOVED' } }],
      ym,
    );
    expect(result.match).toEqual({ kind: 'issue', reason: 'sku_taken', candidateIds: ['p1'] });
  });

  it('пустой штрихкод не склеивает товары', () => {
    const [result] = matchCards(
      [{ sku: 'C1', barcodes: ['', '  '] }],
      [free('p1', { barcodes: [''] })],
      ym,
    );
    expect(result.match).toEqual({ kind: 'create' });
  });

  it('сводка считает уровни и долю карточек с товаром', () => {
    const results = matchCards(
      [
        { sku: 'A1', barcodes: [] },
        { sku: 'B1', barcodes: ['111'] },
        { sku: 'C1', barcodes: [] },
        { sku: 'D1', barcodes: ['222'] },
      ],
      [
        { id: 'p1', internalSku: 'A1', marketplaceSkus: { ym: 'A1' } },
        free('p2', { barcodes: ['111'] }),
        free('p3', { barcodes: ['222'] }),
        free('p4', { barcodes: ['222'] }),
      ],
      ym,
    );
    expect(summarizeMatches(results)).toEqual({
      cards: 4,
      linked: 1,
      matched: { barcode: 1, vendorCode: 0, sku: 0 },
      created: 1,
      issues: { conflict: 1, shared: 0, sku_taken: 0, no_match: 0 },
      skipped: 0,
      boundPercent: 75,
    });
  });

  it('площадка — только из белого списка', () => {
    expect(isMarketplace('ym')).toBe(true);
    expect(isMarketplace('ozon')).toBe(true);
    expect(isMarketplace('toString')).toBe(false);
    expect(isMarketplace(undefined)).toBe(false);
  });
});

describe('ozonCatalogRows (TASK-129)', () => {
  it('артикул — offer_id, штрихкоды без пустых, цена только рублёвая и положительная', () => {
    expect(
      ozonCatalogRows([
        {
          offerId: ' OZ-1 ',
          name: 'Часы',
          barcodes: ['460', ' ', ''],
          price: 1990,
          currency: 'RUB',
        },
        { offerId: 'OZ-2', barcodes: [], price: 10, currency: 'USD' },
        { offerId: 'OZ-3', price: 0, currency: 'RUB' },
        { offerId: '  ', barcodes: ['1'] },
      ]),
    ).toEqual([
      { sku: 'OZ-1', name: 'Часы', barcodes: ['460'], salePrice: 1990 },
      { sku: 'OZ-2', name: undefined, barcodes: [], salePrice: undefined },
      { sku: 'OZ-3', name: undefined, barcodes: [], salePrice: undefined },
    ]);
  });

  it('повтор артикула схлопывается в последнюю карточку; vendorCode не придумывается', () => {
    const rows = ozonCatalogRows([
      { offerId: 'A', barcodes: ['1'] },
      { offerId: 'A', barcodes: ['2'] },
    ]);
    expect(rows).toEqual([{ sku: 'A', name: undefined, barcodes: ['2'], salePrice: undefined }]);
    expect(rows[0].vendorCode).toBeUndefined();
  });

  it('архивная карточка помечена, у живой поля нет (TASK-163)', () => {
    expect(
      ozonCatalogRows([
        { offerId: 'A', archived: true },
        { offerId: 'B', archived: false },
      ]).map((row) => row.archived),
    ).toEqual([true, undefined]);
  });
});
