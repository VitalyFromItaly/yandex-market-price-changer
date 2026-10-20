import { describe, expect, it } from 'vitest';

import {
  brandCounts,
  historyView,
  isBrandFilter,
  linksView,
  matchesProduct,
  pageOf,
  PRODUCT_PAGE_MAX,
} from '../../src/modules/products/product-catalog.domain';
import { validateManualPurchase } from '../../src/modules/products/product-purchase.domain';

/** Раздел CRM «Товары» (TASK-118): чистые правила списка, карточки и правки закупа. */
describe('validateManualPurchase', () => {
  it('рубли: цена строкой с запятой и пробелами, курс не нужен и не пишется', () => {
    expect(validateManualPurchase({ price: '1 234,5', currency: 'rub', rate: '90' })).toEqual({
      ok: true,
      purchase: { price: 1234.5, currency: 'RUR' },
    });
  });

  it('валюта без курса — ошибка под полем rate', () => {
    expect(validateManualPurchase({ price: 10, currency: 'USD' })).toMatchObject({
      ok: false,
      field: 'rate',
    });
  });

  it('цена ноль, мусор, незнакомая валюта и отрицательные доп. расходы — отказ под своим полем', () => {
    expect(validateManualPurchase({ price: 0 })).toMatchObject({ field: 'price' });
    expect(validateManualPurchase({ price: 'abc' })).toMatchObject({ field: 'price' });
    expect(validateManualPurchase({ price: 1, currency: 'JPY' })).toMatchObject({
      field: 'currency',
    });
    expect(validateManualPurchase({ price: 1, extraCosts: '-5' })).toMatchObject({
      field: 'extraCosts',
    });
  });

  it('доп. расходы: пусто и ноль — поля нет; число — есть', () => {
    expect(validateManualPurchase({ price: 1, extraCosts: '' })).toEqual({
      ok: true,
      purchase: { price: 1, currency: 'RUR' },
    });
    expect(validateManualPurchase({ price: 1, extraCosts: 0 })).toEqual({
      ok: true,
      purchase: { price: 1, currency: 'RUR' },
    });
    expect(
      validateManualPurchase({ price: 10, currency: 'usd', rate: '92,5', extraCosts: 40 }),
    ).toEqual({
      ok: true,
      purchase: { price: 10, currency: 'USD', rate: 92.5, extraCosts: 40 },
    });
  });
});

describe('список «Товаров»: поиск и бренд', () => {
  const casio = {
    internalSku: 'GA-100',
    name: 'Casio G-Shock',
    vendorCode: 'GA100-1A',
    marketplaceSkus: { ym: 'ym-1' },
  };
  const noBrand = { internalSku: 'X1', name: 'Ремешок' };

  it('поиск — подстрока без регистра по артикулам и названию', () => {
    expect(matchesProduct(casio, { q: 'g-shock' })).toBe(true);
    expect(matchesProduct(casio, { q: 'ga100' })).toBe(true);
    expect(matchesProduct(casio, { q: 'YM-1' })).toBe(true);
    expect(matchesProduct(casio, { q: 'seiko' })).toBe(false);
  });

  it('бренд — brandOf при чтении; «none» — товары без бренда', () => {
    expect(matchesProduct(casio, { brand: 'casio' })).toBe(true);
    expect(matchesProduct(casio, { brand: 'none' })).toBe(false);
    expect(matchesProduct(noBrand, { brand: 'none' })).toBe(true);
  });

  it('опции бренда со счётчиком, «без бренда» последним; мусор не фильтр', () => {
    expect(brandCounts([casio, noBrand, { name: 'Casio A1' }])).toEqual([
      { key: 'casio', title: expect.any(String), count: 2 },
      { key: 'none', title: 'Без бренда', count: 1 },
    ]);
    expect(isBrandFilter('casio')).toBe(true);
    expect(isBrandFilter('$where')).toBe(false);
  });

  it('страница: мусор — умолчания, размер не выше потолка', () => {
    expect(pageOf('abc', '-1')).toEqual({ page: 1, limit: 50 });
    expect(pageOf('3', '100000')).toEqual({ page: 3, limit: PRODUCT_PAGE_MAX });
  });
});

describe('карточка: история и привязки', () => {
  it('история — новые сверху, стартовая последней, подпись источника и автор', () => {
    const view = historyView([
      { validFrom: null, price: 1000, source: 'baseline' },
      {
        validFrom: '2026-10-17',
        price: 10,
        currency: 'USD',
        rate: 90,
        source: 'manual',
        author: '777',
      },
      { validFrom: '2026-10-10', price: 1100, currency: 'RUR', source: 'price-list' },
    ]);
    expect(view.map((row) => row.validFrom)).toEqual(['2026-10-17', '2026-10-10', null]);
    expect(view[0]).toMatchObject({ sourceText: 'Ручная правка', author: '777' });
    expect(view[2].purchase).toEqual({
      price: 1000,
      currency: 'RUR',
      rate: null,
      extraCosts: null,
    });
  });

  it('привязки — все три площадки, пустые тоже', () => {
    const links = linksView({
      marketplaceSkus: { ym: 'A1' },
      marketplaceLinks: { ym: { source: 'manual', linkedAt: new Date('2026-10-17') } },
      salePrices: { ym: 2500 },
    });
    expect(links.map((link) => link.marketplace)).toEqual(['ym', 'ozon', 'wb']);
    expect(links[0]).toMatchObject({ sku: 'A1', sourceText: 'вручную', salePrice: 2500 });
    expect(links[1]).toMatchObject({ sku: null, source: null });
  });
});
