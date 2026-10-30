import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import type {
  IPriceSetCurrent,
  IPriceSetProduct,
  IPriceSetTargetInput,
} from '../../src/modules/price-set/price-set.domain';

import { PriceFileError, parsePriceFile } from '../../src/modules/price-set/price-set-file';
import {
  isMarkupPercent,
  markupPrice,
  priceSetPlanOf,
  wbBasePrice,
  wbSalePrice,
} from '../../src/modules/price-set/price-set.domain';

function product(
  sku: string,
  purchase: number | null,
  skus: IPriceSetProduct['skus'] = {},
): IPriceSetProduct {
  return { sku, name: `Товар ${sku}`, purchase, skus };
}

function target(
  marketplace: IPriceSetTargetInput['marketplace'],
  current: Record<string, IPriceSetCurrent> | null,
  writable = true,
): IPriceSetTargetInput {
  return { marketplace, current: current ? new Map(Object.entries(current)) : null, writable };
}

function xlsxOf(rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Цены');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('markupPrice', () => {
  it('250% от закупа — закуп × 2,5, до рубля', () => {
    expect(markupPrice(1000, 250)).toBe(2500);
    expect(markupPrice(999.5, 250)).toBe(2499); // 2498,75 → 2499
    expect(markupPrice(333, 150)).toBe(500); // 499,5 → 500
  });

  it('нет закупа или закуп ≤ 0 — null, не 0', () => {
    expect(markupPrice(null, 250)).toBeNull();
    expect(markupPrice(0, 250)).toBeNull();
    expect(markupPrice(-5, 250)).toBeNull();
  });

  it('процент вне границ — не наценка', () => {
    expect(isMarkupPercent(250)).toBe(true);
    expect(isMarkupPercent(0)).toBe(false);
    expect(isMarkupPercent(Number.NaN)).toBe(false);
    expect(isMarkupPercent('250')).toBe(false);
    expect(isMarkupPercent(10_001)).toBe(false);
    expect(markupPrice(1000, 0)).toBeNull();
  });
});

describe('WB: базовая цена под текущую скидку', () => {
  it('со скидкой 20% выходит нужная цена покупателя', () => {
    const base = wbBasePrice(2500, 20);
    expect(base).toBe(3125);
    expect(wbSalePrice(base, 20)).toBe(2500);
  });

  it('без скидки базовая = цена', () => {
    expect(wbBasePrice(2500, 0)).toBe(2500);
    expect(wbBasePrice(2500, undefined)).toBe(2500);
  });
});

describe('priceSetPlanOf — наценка', () => {
  const products = [
    product('A', 1000, { ym: 'A', ozon: 'oz-A', wb: 'wb-A' }),
    product('B', null, { ym: 'B' }),
    product('C', 400, { ym: 'C' }),
  ];

  it('свой процент на каждую площадку, площадки независимы', () => {
    const plan = priceSetPlanOf({
      products,
      desired: { source: 'markup', percents: { ym: 250, ozon: 300 } },
      targets: [
        target('ozon', { 'oz-A': { price: 2900 } }),
        target('ym', { A: { price: 2400 }, B: { price: 100 }, C: { price: 1000 } }),
      ],
    });
    expect(plan.targets.map((t) => t.marketplace)).toEqual(['ym', 'ozon']);
    const [ym, ozon] = plan.targets;
    expect(ym.blockedBy).toBeNull();
    expect(ym.updates).toEqual([
      expect.objectContaining({
        sku: 'A',
        mpSku: 'A',
        from: 2400,
        to: 2500,
        send: 2500,
        risky: false,
      }),
    ]);
    expect(ym.unchanged).toBe(1); // C: 400 × 2,5 = 1000 — уже стоит
    expect(ym.skipped).toEqual([{ sku: 'B', name: 'Товар B', reason: 'no-purchase' }]);
    expect(ozon.updates).toEqual([
      expect.objectContaining({ mpSku: 'oz-A', from: 2900, to: 3000 }),
    ]);
    // Товаров без артикула Ozon нет в плане Ozon — «нет на площадке».
    expect(ozon.skipped.map((s) => [s.sku, s.reason])).toEqual([
      ['B', 'no-card'],
      ['C', 'no-card'],
    ]);
  });

  it('площадка без процента — «не задана наценка», не цена 0', () => {
    const plan = priceSetPlanOf({
      products,
      desired: { source: 'markup', percents: { ym: 250 } },
      targets: [target('ozon', { 'oz-A': { price: 2900 } })],
    });
    expect(plan.targets[0]).toMatchObject({ blockedBy: 'no-markup', updates: [] });
  });

  it('изменение больше ±50% и неизвестная текущая цена — рискованные', () => {
    const plan = priceSetPlanOf({
      products: [
        product('A', 1000, { ym: 'A' }),
        product('C', 400, { ym: 'C' }),
        product('D', 100, { ym: 'D' }),
      ],
      desired: { source: 'markup', percents: { ym: 250 } },
      targets: [target('ym', { A: { price: 1700 }, C: { price: 2100 }, D: { price: null } })],
    });
    const risky = Object.fromEntries(plan.targets[0].updates.map((u) => [u.sku, u.risky]));
    // A: 1700 → 2500 = +47%; C: 2100 → 1000 = −52%; D: сравнить не с чем.
    expect(risky).toEqual({ A: false, C: true, D: true });
  });

  it('не прочитались текущие цены — площадка закрыта, остальные пишутся', () => {
    const plan = priceSetPlanOf({
      products,
      desired: { source: 'markup', percents: { ym: 250, wb: 250 } },
      targets: [target('ym', { A: { price: 2400 } }), target('wb', null)],
    });
    expect(plan.targets[0].blockedBy).toBeNull();
    expect(plan.targets[1]).toMatchObject({ blockedBy: 'read-error', updates: [] });
  });

  it('запись закрыта — строки видны, в отпечаток не входят', () => {
    const open = priceSetPlanOf({
      products,
      desired: { source: 'markup', percents: { ym: 250 } },
      targets: [target('ym', { A: { price: 2400 } })],
    });
    const closed = priceSetPlanOf({
      products,
      desired: { source: 'markup', percents: { ym: 250 } },
      targets: [target('ym', { A: { price: 2400 } }, false)],
    });
    expect(closed.targets[0].blockedBy).toBe('no-write-method');
    expect(closed.targets[0].updates).toHaveLength(1);
    expect(closed.planHash).not.toBe(open.planHash);
  });

  it('WB: сравнение по цене покупателя, в API — базовая под скидку', () => {
    const plan = priceSetPlanOf({
      products: [product('A', 1000, { wb: 'wb-A' })],
      desired: { source: 'markup', percents: { wb: 250 } },
      targets: [target('wb', { 'wb-A': { price: 3000, discount: 20 } })],
    });
    expect(plan.targets[0].updates).toEqual([
      expect.objectContaining({ from: 2400, to: 2500, send: 3125 }),
    ]);
  });

  it('отпечаток не зависит от порядка товаров и площадок', () => {
    const input = {
      desired: { source: 'markup' as const, percents: { ym: 250, ozon: 300 } },
      targets: [
        target('ym', { A: { price: 1 }, C: { price: 1 } }),
        target('ozon', { 'oz-A': { price: 1 } }),
      ],
    };
    const a = priceSetPlanOf({ ...input, products });
    const b = priceSetPlanOf({
      ...input,
      products: [...products].reverse(),
      targets: [...input.targets].reverse(),
    });
    expect(a.planHash).toBe(b.planHash);
  });
});

describe('priceSetPlanOf — файл', () => {
  it('артикул продавца ведёт в артикул площадки; без товара — артикул самой площадки', () => {
    const plan = priceSetPlanOf({
      products: [product('A', null, { ozon: 'oz-A' })],
      desired: {
        source: 'file',
        rows: [
          { sku: 'A', price: 1990.4 },
          { sku: 'free', price: 500 },
          { sku: 'ghost', price: 700 },
        ],
      },
      targets: [target('ozon', { 'oz-A': { price: 2000 }, free: { price: 450 } })],
    });
    const [ozon] = plan.targets;
    expect(ozon.updates.map((u) => [u.sku, u.mpSku, u.to])).toEqual([
      ['A', 'oz-A', 1990],
      ['free', 'free', 500],
    ]);
    expect(ozon.skipped).toEqual([{ sku: 'ghost', name: null, reason: 'no-card' }]);
  });

  it('повтор с другой ценой выпадает, с той же — одна строка', () => {
    const plan = priceSetPlanOf({
      products: [],
      desired: {
        source: 'file',
        rows: [
          { sku: 'X', price: 100 },
          { sku: 'X', price: 200 },
          { sku: 'Y', price: 300 },
          { sku: 'Y', price: 300 },
        ],
      },
      targets: [target('ym', { X: { price: 90 }, Y: { price: 290 } })],
    });
    expect(plan.targets[0].updates.map((u) => u.sku)).toEqual(['Y']);
    expect(plan.targets[0].skipped).toEqual([{ sku: 'X', name: null, reason: 'duplicate' }]);
  });
});

describe('parsePriceFile', () => {
  it('столбцы по заголовку, в любом порядке и под шапкой', () => {
    const result = parsePriceFile(
      xlsxOf([
        ['Прайс на 28.10'],
        [],
        ['Наименование', 'Цена, ₽', 'Ваш артикул'],
        ['Часы', '1 990,50', 'A-1'],
        ['Ремешок', 350, 1234567],
      ]),
      'prices.xlsx',
    );
    expect(result.headerRow).toBe(3);
    expect(result.rows).toEqual([
      { row: 4, sku: 'A-1', price: 1990.5 },
      { row: 5, sku: '1234567', price: 350 },
    ]);
  });

  it('без заголовка — A и B; нечисловая первая строка — заголовок', () => {
    const plain = parsePriceFile(
      xlsxOf([
        ['A-1', 100],
        ['A-2', 200],
      ]),
      'p.xlsx',
    );
    expect(plain.headerRow).toBeNull();
    expect(plain.rows.map((r) => r.sku)).toEqual(['A-1', 'A-2']);

    const named = parsePriceFile(
      xlsxOf([
        ['Код', 'Стоимость'],
        ['A-1', 100],
      ]),
      'p.xlsx',
    );
    expect(named.headerRow).toBe(1);
    expect(named.rows).toEqual([{ row: 2, sku: 'A-1', price: 100 }]);
  });

  it('битые строки — в «пропущено» с номером, файл не падает', () => {
    const result = parsePriceFile(
      xlsxOf([
        ['Артикул', 'Цена'],
        ['A', 'дорого'],
        ['B', 0],
        ['', 500],
        ['C', ''],
        ['D', 10],
      ]),
      'p.xlsx',
    );
    expect(result.rows).toEqual([{ row: 6, sku: 'D', price: 10 }]);
    expect(result.bad).toEqual([
      { row: 2, sku: 'A', reason: 'bad-price' },
      { row: 3, sku: 'B', reason: 'bad-price' },
      { row: 4, sku: null, reason: 'no-sku' },
      { row: 5, sku: 'C', reason: 'bad-price' },
    ]);
  });

  it('CSV в windows-1251 и UTF-8 с BOM', () => {
    const text = 'Артикул;Цена\nА-1;1500\n';
    const cp1251 = Buffer.from(
      [...text].map((ch) => {
        const code = ch.charCodeAt(0);
        if (code === 0x401) return 0xa8;
        if (code >= 0x410 && code <= 0x44f) return code - 0x350;
        return code;
      }),
    );
    for (const buffer of [cp1251, Buffer.from(`\uFEFF${text}`, 'utf-8')]) {
      expect(parsePriceFile(buffer, 'prices.csv').rows).toEqual([
        { row: 2, sku: 'А-1', price: 1500 },
      ]);
    }
  });

  it('пустой файл — понятный отказ', () => {
    expect(() => parsePriceFile(xlsxOf([[]]), 'p.xlsx')).toThrow(PriceFileError);
  });
});
