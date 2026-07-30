import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parsePriceList,
  parseQuantity,
  parseNumber,
  PRICE_LAYOUT,
} from '../../src/modules/yandex/stocks/price-list.parser';
import {
  stripBrand,
  skuCandidates,
  resolveSku,
  BRAND_PREFIXES,
} from '../../src/modules/yandex/stocks/sku-resolver';

const FIXTURE = join(process.cwd(), '__tests__/fixtures/price-template.xlsx');

describe('parseQuantity: пороги в остатках', () => {
  it('«>10» превращается в 11 — минимум, при котором «больше 10» истинно', () => {
    expect(parseQuantity('>10')).toBe(11);
  });

  it('РЕГРЕСС: прежний парсер знал только «>5» и обнулял остальное', () => {
    // Number('>10') === NaN, старый код возвращал 0. В присланном прайсе
    // таких строк 1605 — 37 % позиций обнулилось бы на Маркете молча.
    expect(parseQuantity('>10')).not.toBe(0);
    expect(parseQuantity('>5')).toBe(6);
    expect(parseQuantity('>100')).toBe(101);
  });

  it('пробелы вокруг порога не мешают', () => {
    expect(parseQuantity('> 10')).toBe(11);
    expect(parseQuantity('  >10  ')).toBe(11);
  });

  it('«<N» читается как нижняя граница — занижение безопаснее завышения', () => {
    expect(parseQuantity('<5')).toBe(4);
    expect(parseQuantity('<1')).toBe(0);
    expect(parseQuantity('<0')).toBe(0);
  });

  it('обычные числа проходят как есть', () => {
    expect(parseQuantity('7')).toBe(7);
    expect(parseQuantity(3)).toBe(3);
    expect(parseQuantity('0')).toBe(0);
  });

  it('мусор и пустота дают null, а НЕ ноль', () => {
    // Ноль — это команда «обнулить остаток». Нечитаемая ячейка не должна
    // молча превращаться в такую команду.
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('нет')).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
  });
});

describe('parseNumber: цены с разделителями разрядов', () => {
  it('«18 800» с обычным пробелом', () => {
    expect(parseNumber('18 800')).toBe(18800);
  });

  it('«18 800» с НЕРАЗРЫВНЫМ пробелом — именно так отдаёт Excel', () => {
    expect(parseNumber('18 800')).toBe(18800);
  });

  it('запятая как десятичный разделитель', () => {
    expect(parseNumber('1,5')).toBe(1.5);
  });

  it('наивный parseFloat здесь ошибся бы', () => {
    expect(parseFloat('18 800')).toBe(18); // так делать нельзя
    expect(parseNumber('18 800')).toBe(18800);
  });
});

describe('stripBrand: отсечение бренда', () => {
  it('пример заказчика', () => {
    expect(stripBrand('Casio a158wa-1a')).toBe('a158wa-1a');
  });

  it('двухсловный бренд отрезается целиком', () => {
    // Если бы порядок в BRAND_PREFIXES был другим, вышло бы «Klein 11468-2».
    expect(stripBrand('Daniel Klein 11468-2')).toBe('11468-2');
  });

  it('ORIENT STAR проверяется раньше ORIENT', () => {
    expect(stripBrand('ORIENT STAR RE-AU0001S')).toBe('RE-AU0001S');
    expect(BRAND_PREFIXES.indexOf('ORIENT STAR')).toBeLessThan(BRAND_PREFIXES.indexOf('ORIENT'));
  });

  it('хвост сохраняется ДОСЛОВНО — суффиксы часть артикула', () => {
    expect(stripBrand('Командирские 921163 с АПЗ')).toBe('921163 с АПЗ');
    expect(stripBrand('Амфибия 14038Г Космодайвер')).toBe('14038Г Космодайвер');
    expect(stripBrand('ORIENT RE-AT0205L00B Limited Edition')).toBe(
      'RE-AT0205L00B Limited Edition',
    );
  });

  it('КЛЮЧЕВОЕ: «К-35» больше не схлопывает 11 товаров в один', () => {
    const names = [
      'Командирские 350501 К-35',
      'Командирские 350503 К-35',
      'Командирские 350504 К-35',
    ];
    const skus = names.map(stripBrand);
    expect(skus).toEqual(['350501 К-35', '350503 К-35', '350504 К-35']);
    expect(new Set(skus).size).toBe(3); // раньше был бы 1
  });

  it('имя без бренда уже является артикулом', () => {
    expect(stripBrand('AW-500BB-4E')).toBe('AW-500BB-4E');
    expect(stripBrand('540533 EXCLUSIVE')).toBe('540533 EXCLUSIVE');
  });

  it('бренд без пробела после — не бренд', () => {
    // «CASIOTRON» не должен превратиться в «TRON».
    expect(stripBrand('CASIOTRON X1')).toBe('CASIOTRON X1');
  });

  it('кириллические буквы не конвертируются', () => {
    // Проверено сверкой: каталог и прайс используют одни символы.
    const sku = stripBrand('Командирские 21118В');
    expect(sku).toBe('21118В');
    expect(sku.charCodeAt(5)).toBe(1042); // кириллическая В, не латинская B
  });
});

describe('resolveSku: перебор кандидатов по неоднородному каталогу', () => {
  it('порядок кандидатов: без бренда, как в прайсе, с приставкой', () => {
    expect(skuCandidates('CASIO A158')).toEqual(['A158', 'CASIO A158', 'Наручные часы CASIO A158']);
  });

  it('голый код — основной случай (5312 из 5599 в каталоге)', () => {
    const r = resolveSku('CASIO A158WA-1D', new Set(['A158WA-1D']));
    expect(r).toEqual({ sku: 'A158WA-1D', matchedBy: 'без бренда' });
  });

  it('приставка «Наручные часы» — так заведены 285 Daniel Klein', () => {
    const r = resolveSku('Daniel Klein 14273-2', new Set(['Наручные часы Daniel Klein 14273-2']));
    expect(r.sku).toBe('Наручные часы Daniel Klein 14273-2');
    expect(r.matchedBy).toBe('приставка «Наручные часы»');
  });

  it('имя целиком — так заведены 2 ORIENT Limited Edition', () => {
    const name = 'ORIENT RE-AT0205L00B Limited Edition';
    const r = resolveSku(name, new Set([name]));
    expect(r.sku).toBe(name);
    expect(r.matchedBy).toBe('как в прайсе');
  });

  it('нет в каталоге — не ошибка, а пропуск', () => {
    expect(resolveSku('CASIO НЕТ-ТАКОГО', new Set())).toEqual({
      sku: null,
      matchedBy: null,
    });
  });

  it('приоритет: при совпадении нескольких вариантов берётся первый', () => {
    const catalog = new Set(['A158', 'CASIO A158']);
    expect(resolveSku('CASIO A158', catalog).matchedBy).toBe('без бренда');
  });
});

describe('parsePriceList на реальном файле заказчика', () => {
  const buffer = readFileSync(FIXTURE);
  const { rows, invalid } = parsePriceList(buffer);

  it('разбирает ВСЕ товарные строки без единой ошибки', () => {
    expect(rows).toHaveLength(4349);
    expect(invalid).toHaveLength(0);
  });

  it('строки-заголовки категорий не попадают в товары', () => {
    // «ORIENT механические» и ещё 17 — это разделы, а не часы.
    expect(rows.some((r) => r.name === 'ORIENT механические')).toBe(false);
    expect(new Set(rows.map((r) => r.category)).size).toBeGreaterThan(10);
  });

  it('РЕГРЕСС: ни одна позиция не получила остаток 0 по ошибке разбора', () => {
    // 1605 порогов «>10» на старой логике стали бы нулями.
    expect(rows.filter((r) => r.quantity === 0)).toHaveLength(0);
    expect(rows.filter((r) => r.quantity === 11)).toHaveLength(1605);
  });

  it('артикулы уникальны — коллизий нет', () => {
    const skus = rows.map((r) => stripBrand(r.name));
    expect(new Set(skus).size).toBe(rows.length);
  });

  it('цены и номера строк заполнены', () => {
    const first = rows[0];
    expect(first.name).toBe('ORIENT FAA02006M');
    expect(first.price).toBe(18800);
    expect(first.quantity).toBe(2);
    expect(first.rowNumber).toBe(PRICE_LAYOUT.firstDataRow);
  });
});
