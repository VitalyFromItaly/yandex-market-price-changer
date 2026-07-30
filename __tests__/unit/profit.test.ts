import { describe, it, expect } from 'vitest';

import {
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_DISCOUNT_PERCENT,
  DEFAULT_RATES,
  DEFAULT_TAX_PERCENT,
  DEFAULT_VOSTOK_DISCOUNT_PERCENT,
  applyDiscounts,
  discountGroup,
  normalizeRate,
  purchaseCost,
  orderPurchase,
  orderSkus,
  parseRateInput,
  profitOf,
  rateTitle,
  ratesOf,
  validateRate,
} from '../../src/modules/yandex/reports/profit';
import { formatRubles, NBSP } from '../../src/modules/yandex/reports/money';
import { formatProfitReport } from '../../src/modules/yandex/reports/profit-message';
import { DEFAULT_PERIOD } from '../../src/modules/yandex/reports/report-period';

/** Заказ на 10 000 ₽ из одной позиции по 5 000 ₽ закупа. */
const ORDER = {
  id: 1,
  itemsTotal: 10000,
  deliveryTotal: 500,
  items: [{ offerId: 'A1', count: 1 }],
};

const COSTS = new Map([['A1', 5000]]);

/**
 * Арифметика прибыли.
 *
 * Ошибка здесь не роняет ничего — она даёт правдоподобное неверное число, по
 * которому продавец принимает решения. Поэтому проверяется каждое правило
 * отдельно, и отдельно же — что база налога именно та, о которой договорились.
 */
describe('Формула прибыли', () => {
  it('оба процента считаются ОТ СУММЫ ПРОДАЖИ, а не последовательно', () => {
    const totals = profitOf([ORDER], COSTS, DEFAULT_RATES);

    expect(totals.revenue).toBe(10000);
    expect(totals.commission).toBe(2300);
    // 700 — это 7 % от 10 000. Если бы налог брался с остатка после комиссии
    // (с 7 700), вышло бы 539 — и число выглядело бы столь же правдоподобно.
    expect(totals.tax).toBe(700);
    expect(totals.purchase).toBe(5000);
    expect(totals.net).toBe(2000);
  });

  it('доставка в расчёт НЕ входит: её платит покупатель', () => {
    // itemsTotal 10 000, deliveryTotal 500 — выручка ровно 10 000.
    const totals = profitOf([ORDER], COSTS);
    expect(totals.revenue).toBe(10000);
    expect(totals.net).toBe(2000);
  });

  it('ставки по умолчанию — 23, 7, скидки 10 и 4', () => {
    expect(DEFAULT_COMMISSION_PERCENT).toBe(23);
    expect(DEFAULT_TAX_PERCENT).toBe(7);
    expect(DEFAULT_DISCOUNT_PERCENT).toBe(10);
    expect(DEFAULT_VOSTOK_DISCOUNT_PERCENT).toBe(4);
    expect(profitOf([ORDER], COSTS).rates).toEqual({
      commissionPercent: 23,
      taxPercent: 7,
      discountPercent: 10,
      vostokDiscountPercent: 4,
    });
  });

  it('свои ставки применяются', () => {
    const totals = profitOf([ORDER], COSTS, {
      ...DEFAULT_RATES,
      commissionPercent: 10,
      taxPercent: 0,
    });

    expect(totals.commission).toBe(1000);
    expect(totals.tax).toBe(0);
    expect(totals.net).toBe(4000);
  });

  it('количество умножает закуп', () => {
    const totals = profitOf([{ itemsTotal: 30000, items: [{ offerId: 'A1', count: 3 }] }], COSTS);
    expect(totals.purchase).toBe(15000);
  });

  it('позиция без count считается за одну штуку, а не за ноль', () => {
    // Ноль означал бы бесплатный товар и завысил бы прибыль.
    const totals = profitOf([{ itemsTotal: 10000, items: [{ offerId: 'A1' }] }], COSTS);
    expect(totals.purchase).toBe(5000);
  });

  it('несколько позиций и несколько заказов складываются', () => {
    const costs = new Map([
      ['A1', 5000],
      ['B2', 1000],
    ]);
    const totals = profitOf(
      [
        { itemsTotal: 10000, items: [{ offerId: 'A1', count: 1 }] },
        {
          itemsTotal: 4000,
          items: [
            { offerId: 'B2', count: 2 },
            { offerId: 'A1', count: 1 },
          ],
        },
      ],
      costs,
    );

    expect(totals.orders).toBe(2);
    expect(totals.revenue).toBe(14000);
    expect(totals.purchase).toBe(5000 + 2000 + 5000);
  });

  it('чистая бывает отрицательной — это результат, а не сбой', () => {
    const totals = profitOf([{ itemsTotal: 1000, items: [{ offerId: 'A1', count: 1 }] }], COSTS);

    expect(totals.net).toBeLessThan(0);
    expect(totals.net).toBe(1000 - 230 - 70 - 5000);
  });

  it('пустой список заказов даёт нули, а не NaN', () => {
    const totals = profitOf([], COSTS);

    expect(totals.revenue).toBe(0);
    expect(totals.net).toBe(0);
    expect(totals.orders).toBe(0);
    expect(Number.isNaN(totals.net)).toBe(false);
  });

  it('мусор вместо сумм не превращается в NaN', () => {
    const totals = profitOf(
      [{ itemsTotal: undefined, items: [{ offerId: 'A1', count: 1 }] } as never],
      COSTS,
    );

    expect(totals.revenue).toBe(0);
    expect(totals.net).toBe(-5000);
  });

  it('промежуточных округлений нет: копейки доживают до вывода', () => {
    const totals = profitOf(
      [{ itemsTotal: 100.55, items: [{ offerId: 'A1', count: 1 }] }],
      new Map([['A1', 10.11]]),
    );

    expect(totals.commission).toBeCloseTo(23.1265, 4);
    expect(totals.net).toBeCloseTo(100.55 - 23.1265 - 7.0385 - 10.11, 4);
  });

  it('никаких скрытых надбавок и коэффициентов (регресс на старый код)', () => {
    // В отключённом изменении цен жили «+5 ₽» на одном из двух путей и
    // коэффициент 2 вместо 1.2, то есть молчаливое удвоение.
    for (const price of [1, 5, 10, 100]) {
      const totals = profitOf(
        [{ itemsTotal: price, items: [{ offerId: 'A1', count: 1 }] }],
        new Map([['A1', 0]]),
      );
      expect(totals.revenue).toBe(price);
      expect(totals.net).toBeCloseTo(price * 0.7, 10);
    }
  });
});

describe('Заказы без закупа', () => {
  it('заказ с неизвестной позицией исключается ЦЕЛИКОМ', () => {
    const totals = profitOf(
      [ORDER, { itemsTotal: 7000, items: [{ offerId: 'НЕТ', count: 1 }] }],
      COSTS,
    );

    expect(totals.orders).toBe(1);
    expect(totals.revenue).toBe(10000);
    expect(totals.excludedOrders).toBe(1);
    expect(totals.excludedRevenue).toBe(7000);
    expect(totals.unknownSkus).toEqual(['НЕТ']);
  });

  it('заказ исключается, даже если известна ЧАСТЬ позиций', () => {
    // Иначе закуп по заказу оказался бы занижен, а прибыль завышена — молча.
    const totals = profitOf(
      [
        {
          itemsTotal: 12000,
          items: [
            { offerId: 'A1', count: 1 },
            { offerId: 'НЕТ', count: 1 },
          ],
        },
      ],
      COSTS,
    );

    expect(totals.orders).toBe(0);
    expect(totals.excludedOrders).toBe(1);
    // В список попадает только то, чего действительно нет.
    expect(totals.unknownSkus).toEqual(['НЕТ']);
  });

  it('заказ без позиций тоже исключается: считать нечем', () => {
    const totals = profitOf([{ itemsTotal: 500, items: [] }], COSTS);

    expect(totals.orders).toBe(0);
    expect(totals.excludedOrders).toBe(1);
  });

  it('позиция без артикула — это неизвестный закуп, а не нулевой', () => {
    const totals = profitOf([{ itemsTotal: 500, items: [{ count: 1 }] }], COSTS);

    expect(totals.excludedOrders).toBe(1);
    expect(totals.unknownSkus).toEqual(['(без артикула)']);
  });

  it('orderPurchase возвращает null, а не 0', () => {
    expect(orderPurchase(ORDER, COSTS)).toBe(5000);
    expect(orderPurchase({ itemsTotal: 1, items: [{ offerId: 'НЕТ' }] }, COSTS)).toBeNull();
  });

  it('orderSkus собирает артикулы без дублей', () => {
    const skus = orderSkus([
      ORDER,
      { itemsTotal: 1, items: [{ offerId: 'A1' }, { offerId: 'B2' }] },
    ]);
    expect(skus.sort()).toEqual(['A1', 'B2']);
  });
});

/**
 * Возвраты.
 *
 * Возврат ПОСЛЕ выкупа заказ из статуса DELIVERED не выводит: он живёт отдельной
 * сущностью в методе возвратов. Без вычета прибыль завышена на сумму возврата, и
 * выглядит это совершенно нормально.
 */
describe('Возвраты', () => {
  const RETURNED = { returned: new Set([1]) };

  it('заказ с возвратом исключается ЦЕЛИКОМ: ни выручки, ни закупа', () => {
    const totals = profitOf([ORDER], COSTS, DEFAULT_RATES, RETURNED);

    expect(totals.orders).toBe(0);
    expect(totals.revenue).toBe(0);
    expect(totals.purchase).toBe(0);
    expect(totals.commission).toBe(0);
    expect(totals.tax).toBe(0);
    expect(totals.net).toBe(0);
    expect(totals.returnedOrders).toBe(1);
    expect(totals.returnedRevenue).toBe(10000);
  });

  it('остальные заказы считаются как обычно', () => {
    const totals = profitOf(
      [ORDER, { id: 2, itemsTotal: 10000, items: [{ offerId: 'A1', count: 1 }] }],
      COSTS,
      DEFAULT_RATES,
      RETURNED,
    );

    expect(totals.orders).toBe(1);
    expect(totals.revenue).toBe(10000);
    expect(totals.net).toBe(2000);
    expect(totals.returnedOrders).toBe(1);
  });

  it('id сравнивается и числом, и строкой', () => {
    // Из API он приходит числом, из наших структур мог прийти строкой.
    const asString = profitOf([ORDER], COSTS, DEFAULT_RATES, { returned: new Set(['1']) });
    expect(asString.returnedOrders).toBe(1);
  });

  it('возврат ВАЖНЕЕ отсутствия закупа', () => {
    // Иначе продавец увидит «нет закупочной цены» и пойдёт грузить прайс, хотя
    // проблема не в прайсе: заказ вернули.
    const totals = profitOf(
      [{ id: 1, itemsTotal: 10000, items: [{ offerId: 'НЕТ', count: 1 }] }],
      COSTS,
      DEFAULT_RATES,
      RETURNED,
    );

    expect(totals.returnedOrders).toBe(1);
    expect(totals.excludedOrders).toBe(0);
    expect(totals.unknownSkus).toEqual([]);
  });

  it('пустой набор возвратов ничего не меняет', () => {
    const empty = profitOf([ORDER], COSTS, DEFAULT_RATES, { returned: new Set() });
    const none = profitOf([ORDER], COSTS);

    expect(empty).toEqual(none);
    expect(empty.returnedOrders).toBe(0);
  });

  it('заказ без id под возврат не попадает', () => {
    // Сопоставить его с возвратом нечем, а исключить «на всякий случай» —
    // значит молча потерять выручку.
    const totals = profitOf(
      [{ itemsTotal: 10000, items: [{ offerId: 'A1', count: 1 }] }],
      COSTS,
      DEFAULT_RATES,
      RETURNED,
    );

    expect(totals.returnedOrders).toBe(0);
    expect(totals.orders).toBe(1);
  });

  it('в отчёте возвраты названы прямо, а не спрятаны в разнице сумм', () => {
    const text = formatProfitReport({
      period: DEFAULT_PERIOD,
      pricesUpdatedAt: new Date('2026-07-29T09:00:00Z'),
      totals: profitOf([ORDER], COSTS, DEFAULT_RATES, RETURNED),
    });

    expect(text).toContain('Возвраты');
    expect(text).toContain('исключены из расчёта');
    // «Выкупленных заказов нет» было бы неправдой: заказ был, его вернули.
    expect(text).not.toContain('выкупленных заказов нет');
  });
});

/**
 * Скидка от прайса.
 *
 * В прайсе стоит цена поставщика, а не закуп. Без скидок расчёт на боевых данных
 * давал убыток — «закуп» составлял 75,8 % выручки.
 */
describe('Скидки от прайса', () => {
  it('«Восток» узнаётся и по категории, и по названию', () => {
    expect(discountGroup({ price: 1, category: 'Восток' })).toBe('vostok');
    expect(discountGroup({ price: 1, category: 'Командирские' })).toBe('vostok');
    expect(discountGroup({ price: 1, category: 'Партнер' })).toBe('vostok');
    // «Амфибия» отдельной категорией не идёт — она внутри «Востока», но видна
    // в наименовании.
    expect(discountGroup({ price: 1, name: 'Восток Амфибия 420831' })).toBe('vostok');
    expect(discountGroup({ price: 1, name: 'Командирские 350501 К-35' })).toBe('vostok');
  });

  it('всё остальное — общая группа', () => {
    expect(
      discountGroup({ price: 1, category: 'ORIENT кварцевые', name: 'ORIENT FAA02006M' }),
    ).toBe('other');
    expect(discountGroup({ price: 1, category: 'CASIO COLLECTION' })).toBe('other');
    expect(discountGroup({ price: 1 })).toBe('other');
  });

  it('закуп = цена прайса минус скидка своей группы', () => {
    // Восток: 4 % → 9600. Остальное: 10 % → 9000.
    expect(purchaseCost({ price: 10000, category: 'Восток' })).toBe(9600);
    expect(purchaseCost({ price: 10000, category: 'CASIO COLLECTION' })).toBe(9000);
  });

  it('свои проценты применяются', () => {
    const rates = { ...DEFAULT_RATES, discountPercent: 20, vostokDiscountPercent: 50 };

    expect(purchaseCost({ price: 1000, category: 'Восток' }, rates)).toBe(500);
    expect(purchaseCost({ price: 1000, category: 'ORIENT' }, rates)).toBe(800);
  });

  it('нулевая скидка означает «закуп равен прайсу», а не дефолт', () => {
    const rates = { ...DEFAULT_RATES, discountPercent: 0, vostokDiscountPercent: 0 };

    expect(purchaseCost({ price: 1000, category: 'ORIENT' }, rates)).toBe(1000);
    expect(purchaseCost({ price: 1000, category: 'Восток' }, rates)).toBe(1000);
  });

  it('мусор в проценте скидки схлопывается в дефолт', () => {
    const rates = { ...DEFAULT_RATES, discountPercent: 500 } as never;
    expect(purchaseCost({ price: 1000, category: 'ORIENT' }, rates)).toBe(900);
  });

  it('applyDiscounts переводит цены прайса в закуп по всем позициям', () => {
    const rows = new Map([
      ['A1', { price: 10000, category: 'ORIENT' }],
      ['V1', { price: 10000, category: 'Восток' }],
    ]);

    const costs = applyDiscounts(rows);

    expect(costs.get('A1')).toBe(9000);
    expect(costs.get('V1')).toBe(9600);
    expect(costs.size).toBe(2);
  });

  it('прибыль считается по закупу СО скидкой', () => {
    const rows = new Map([['A1', { price: 5000, category: 'ORIENT' }]]);
    const totals = profitOf([ORDER], applyDiscounts(rows));

    // Закуп 5000 − 10 % = 4500, значит чистая 10000×0,70 − 4500 = 2500,
    // а не 2000, как было бы по цене прайса.
    expect(totals.purchase).toBe(4500);
    expect(totals.net).toBe(2500);
  });

  it('в отчёте видно, из чего получен закуп', () => {
    // Иначе сумма закупа выглядит взятой с потолка: в прайсе стоят другие числа.
    const text = formatProfitReport({
      period: DEFAULT_PERIOD,
      pricesUpdatedAt: new Date('2026-07-29T09:00:00Z'),
      totals: profitOf([ORDER], COSTS),
    });

    expect(text).toContain('прайс от 29-07-2026');
    expect(text).toContain('минус 10%');
    expect(text).toContain('Восток 4%');
  });
});

describe('Ставки', () => {
  it('мусор в базе схлопывается в дефолт, а не роняет отчёт', () => {
    expect(normalizeRate(undefined, 23)).toBe(23);
    // Number(null) === 0: без отдельной проверки «ставки нет» стало бы
    // «комиссия ноль процентов» и завысило бы прибыль.
    expect(normalizeRate(null, 23)).toBe(23);
    expect(normalizeRate('', 23)).toBe(23);
    expect(normalizeRate('двадцать три', 23)).toBe(23);
    expect(normalizeRate(-5, 23)).toBe(23);
    expect(normalizeRate(1000, 23)).toBe(23);
    expect(normalizeRate(0, 23)).toBe(0);
    expect(normalizeRate(25.5, 23)).toBe(25.5);
  });

  it('ratesOf читает документ магазина и подставляет дефолты', () => {
    expect(ratesOf({})).toEqual(DEFAULT_RATES);
    expect(ratesOf({ commissionPercent: 25, taxPercent: 6, discountPercent: 15 })).toEqual({
      commissionPercent: 25,
      taxPercent: 6,
      discountPercent: 15,
      vostokDiscountPercent: 4,
    });
  });

  it('подпись разбирается по-русски и по-английски', () => {
    expect(parseRateInput('комиссия: 25')).toEqual({ field: 'commissionPercent', value: 25 });
    expect(parseRateInput('Комиссия:25')).toEqual({ field: 'commissionPercent', value: 25 });
    expect(parseRateInput('commission: 25')).toEqual({ field: 'commissionPercent', value: 25 });
    expect(parseRateInput('налог: 7')).toEqual({ field: 'taxPercent', value: 7 });
    expect(parseRateInput('tax: 7')).toEqual({ field: 'taxPercent', value: 7 });
  });

  it('двухсловная подпись скидки не путается с общей', () => {
    // «скидка восток» частнее «скидки»: если общая подпись съест частную,
    // продавец молча изменит не тот процент.
    expect(parseRateInput('скидка: 10')).toEqual({ field: 'discountPercent', value: 10 });
    expect(parseRateInput('скидка восток: 4')).toEqual({
      field: 'vostokDiscountPercent',
      value: 4,
    });
    expect(parseRateInput('Скидка на Восток: 4')).toEqual({
      field: 'vostokDiscountPercent',
      value: 4,
    });
    expect(parseRateInput('скидка   восток : 4')).toEqual({
      field: 'vostokDiscountPercent',
      value: 4,
    });
    expect(parseRateInput('discount: 10')).toEqual({ field: 'discountPercent', value: 10 });
    // Незнакомая двухсловная подпись — не догадка, а отказ.
    expect(parseRateInput('скидка орient: 5')).toBeNull();
  });

  it('принимается то, как люди пишут: запятая, точка, знак процента', () => {
    expect(parseRateInput('комиссия: 23,5')?.value).toBe(23.5);
    expect(parseRateInput('комиссия: 23.5')?.value).toBe(23.5);
    expect(parseRateInput('комиссия: 23%')?.value).toBe(23);
    expect(parseRateInput('  налог : 7 % ')?.value).toBe(7);
  });

  it('чужие подписи не перехватываются — иначе токен уехал бы в ставку', () => {
    expect(parseRateInput('token: ACMA:secret')).toBeNull();
    expect(parseRateInput('campaign_id: 12345678')).toBeNull();
    expect(parseRateInput('просто текст')).toBeNull();
    expect(parseRateInput('23')).toBeNull();
    expect(parseRateInput('')).toBeNull();
  });

  it('процент вне 0–100 отклоняется с внятным текстом', () => {
    expect(validateRate('commissionPercent', 23).ok).toBe(true);
    expect(validateRate('commissionPercent', 0).ok).toBe(true);
    expect(validateRate('commissionPercent', 100).ok).toBe(true);

    const tooBig = validateRate('taxPercent', 200);
    expect(tooBig.ok).toBe(false);
    expect(tooBig.error).toContain('процентах');
    expect(tooBig.error).toContain('200');

    expect(validateRate('taxPercent', -1).ok).toBe(false);
    expect(validateRate('taxPercent', NaN).ok).toBe(false);
  });

  it('у ставки есть человеческое название', () => {
    expect(rateTitle('commissionPercent')).toContain('Комиссия');
    expect(rateTitle('taxPercent')).toContain('Налог');
    expect(rateTitle('vostokDiscountPercent')).toContain('Восток');
    expect(rateTitle('discountPercent')).toBe('Скидка от прайса');
  });
});

describe('Текст отчёта о прибыли', () => {
  const report = {
    period: DEFAULT_PERIOD,
    pricesUpdatedAt: new Date('2026-07-29T09:00:00Z'),
    totals: profitOf([ORDER], COSTS),
  };

  it('видны все вычитания, проценты и чистая', () => {
    const text = formatProfitReport(report, new Date('2026-07-30T09:00:00Z'));

    expect(text).toContain('Продажи');
    expect(text).toContain('Комиссия 23%');
    expect(text).toContain('Налог 7%');
    expect(text).toContain('Закуп');
    expect(text).toContain('Чистая');
    expect(text).toContain(formatRubles(2000));
  });

  it('дата прайса печатается по Москве', () => {
    const text = formatProfitReport(report, new Date('2026-07-30T09:00:00Z'));
    expect(text).toContain('29-07-2026');
  });

  it('без закупа в базе честно говорит об этом', () => {
    const text = formatProfitReport({ ...report, pricesUpdatedAt: null });
    expect(text).toContain('Закупочных цен пока нет');
  });

  it('исключённые заказы названы числом и суммой', () => {
    const totals = profitOf(
      [ORDER, { itemsTotal: 7000, items: [{ offerId: 'НЕТ-В-ПРАЙСЕ', count: 1 }] }],
      COSTS,
    );
    const text = formatProfitReport({ ...report, totals });

    expect(text).toContain('Не учтено заказов');
    expect(text).toContain('НЕТ-В-ПРАЙСЕ');
    expect(text).toContain(formatRubles(7000));
  });

  it('пустой период — это результат, а не ошибка', () => {
    const text = formatProfitReport({ ...report, totals: profitOf([], COSTS) });
    expect(text).toContain('выкупленных заказов нет');
    expect(text).not.toContain('Чистая');
  });

  it('дробная ставка печатается без лишнего нуля', () => {
    const totals = profitOf([ORDER], COSTS, { ...DEFAULT_RATES, commissionPercent: 23.5 });
    const text = formatProfitReport({ ...report, totals });

    expect(text).toContain('Комиссия 23.5%');
    expect(text).not.toContain('23.50%');
  });

  it('отрицательная чистая отмечена и читается', () => {
    const totals = profitOf([{ itemsTotal: 1000, items: [{ offerId: 'A1', count: 1 }] }], COSTS);
    const text = formatProfitReport({ ...report, totals });

    expect(text).toContain('🔻');
    expect(text).toContain('-4');
  });
});

describe('Формат отрицательных сумм', () => {
  it('минус сохраняется, разряды разделены неразрывным пробелом', () => {
    const text = formatRubles(-1234);

    expect(text.startsWith('-')).toBe(true);
    expect(text).toContain(NBSP);
    expect(text).not.toContain(' '); // обычных пробелов нет — Telegram их переносит
  });
});
