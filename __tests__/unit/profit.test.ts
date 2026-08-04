import { describe, it, expect } from 'vitest';

import {
  DEFAULT_COMMISSION_PERCENT,
  DEFAULT_DISCOUNT_PERCENT,
  DEFAULT_RATES,
  DEFAULT_TAX_PERCENT,
  DEFAULT_VOSTOK_DISCOUNT_PERCENT,
  RATE_CB_CANCEL,
  RATE_FIELDS,
  applyDiscounts,
  isRateField,
  normalizeRate,
  purchaseCost,
  orderPurchase,
  orderSkus,
  parseRateCallback,
  parseRateInput,
  parseRateValue,
  profitOf,
  rateCallback,
  rateInputLabel,
  rateShortLabel,
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
  // Определение бренда (brandOf) пинится в brands.test.ts; здесь — что скидка
  // бренда действительно доезжает до закупа.
  it('закуп = цена прайса минус скидка своего бренда', () => {
    // Восток: 4 % (легаси-фолбэк) → 9600. Бренд без записи: дефолт 10 % → 9000.
    expect(purchaseCost({ price: 10000, category: 'Восток' })).toBe(9600);
    expect(purchaseCost({ price: 10000, category: 'CASIO COLLECTION' })).toBe(9000);
  });

  it('свои проценты применяются: легаси-поле «Востока» и карта брендов', () => {
    const rates = { ...DEFAULT_RATES, discountPercent: 20, vostokDiscountPercent: 50 };

    expect(purchaseCost({ price: 1000, category: 'Восток' }, rates)).toBe(500);
    expect(purchaseCost({ price: 1000, category: 'ORIENT' }, rates)).toBe(800);

    // Явная запись карты сильнее и легаси-поля, и дефолта.
    const withMap = {
      ...DEFAULT_RATES,
      brandDiscounts: { vostok: 30, orient: 5 },
    };
    expect(purchaseCost({ price: 1000, category: 'Восток' }, withMap)).toBe(700);
    expect(purchaseCost({ price: 1000, category: 'ORIENT' }, withMap)).toBe(950);
    expect(purchaseCost({ price: 1000, category: 'CASIO' }, withMap)).toBe(900);
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

  it('общая скидка разбирается, брендовая подпись сюда не входит', () => {
    expect(parseRateInput('скидка: 10')).toEqual({ field: 'discountPercent', value: 10 });
    expect(parseRateInput('discount: 10')).toEqual({ field: 'discountPercent', value: 10 });
    // «скидка восток» — забота parseBrandDiscountInput (brands.test.ts); этот
    // парсер обязан её отвергнуть, чтобы обработчик успел спросить брендовый.
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
    expect(rateTitle('discountPercent')).toBe('Скидка от прайса');
  });

  /**
   * Список ставок обязан быть полным: по нему рисуются кнопки экрана настроек и
   * по нему же проверяется, что пришло в `pendingRate`. Пропущенное поле — это
   * ставка, которую нельзя изменить и которая не видна на экране.
   */
  it('в списке все три ставки, и каждая — известное поле', () => {
    expect(RATE_FIELDS).toHaveLength(3);

    // В DEFAULT_RATES ключей больше НАМЕРЕННО: vostokDiscountPercent остался
    // легаси-фолбэком бренда «Восток» и кнопкой-ставкой быть перестал, а
    // brandDiscounts — карта, не ставка. Ставки обязаны быть подмножеством.
    const rateKeys = Object.keys(DEFAULT_RATES);
    for (const field of RATE_FIELDS) {
      expect(rateKeys).toContain(field);
      expect(isRateField(field)).toBe(true);
    }

    expect(isRateField('vostokDiscountPercent')).toBe(false);
    expect(isRateField('priceCoefficient')).toBe(false);
    expect(isRateField(undefined)).toBe(false);
    expect(isRateField(null)).toBe(false);
  });

  it('голое число разбирается: с запятой, с точкой, со знаком процента', () => {
    expect(parseRateValue('23')).toBe(23);
    expect(parseRateValue(' 23 ')).toBe(23);
    expect(parseRateValue('23,5')).toBe(23.5);
    expect(parseRateValue('23.5')).toBe(23.5);
    expect(parseRateValue('7 %')).toBe(7);
    expect(parseRateValue('0')).toBe(0);
  });

  /**
   * Границы между двумя парсерами. Голое число — ответ на вопрос бота, подпись —
   * сообщение по своей воле, и путать их нельзя: `parseRateValue`, поймавший
   * дату, увёл бы отчёт за день в настройки прибыли.
   */
  it('не числом не считается ни дата, ни время, ни подписанное значение', () => {
    expect(parseRateValue('28-07-2026')).toBeNull();
    expect(parseRateValue('09:00')).toBeNull();
    expect(parseRateValue('комиссия: 23')).toBeNull();
    expect(parseRateValue('23 процента')).toBeNull();
    expect(parseRateValue('')).toBeNull();
    expect(parseRateValue('ACMA:token')).toBeNull();
  });

  it('подпись для ввода — та самая, которую понимает парсер', () => {
    for (const field of RATE_FIELDS) {
      const label = rateInputLabel(field);
      expect(parseRateInput(`${label}: 5`)).toEqual({ field, value: 5 });
    }

    expect(rateInputLabel('discountPercent')).toBe('скидка');
  });

  it('на кнопке подпись короткая и со своим значком', () => {
    const labels = RATE_FIELDS.map((field) => rateShortLabel(field));

    expect(new Set(labels).size).toBe(RATE_FIELDS.length);
    for (const label of labels) {
      // Длинная подпись в ряду из двух кнопок обрезается Telegram до
      // неразличимого огрызка — ровно та беда, из-за которой подписи рассылки
      // стали галочкой вместо глагола.
      expect(label.length).toBeLessThanOrEqual(12);
    }
  });

  it('callback_data кнопки разбирается обратно и укладывается в лимит Telegram', () => {
    for (const field of RATE_FIELDS) {
      const data = rateCallback(field);
      expect(parseRateCallback(data)).toBe(field);
      // Лимит Telegram на callback_data — 64 байта.
      expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
    }

    expect(parseRateCallback(RATE_CB_CANCEL)).toBe('cancel');
  });

  it('чужой callback_data ставкой не считается', () => {
    expect(parseRateCallback('rate:priceCoefficient')).toBeNull();
    expect(parseRateCallback('rep:month:profit')).toBeNull();
    expect(parseRateCallback('store_pick:12345')).toBeNull();
    expect(parseRateCallback('rate:')).toBeNull();
    expect(parseRateCallback('')).toBeNull();
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
    // Формулировка про «выкупленные» ушла вместе с одним набором: теперь
    // отчёт смотрит и на оформленные, и пустым он бывает только когда нет
    // ни тех, ни других.
    const text = formatProfitReport({ ...report, totals: profitOf([], COSTS) });
    expect(text).toContain('заказов нет');
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

/**
 * Субсидии Маркета в выручке (TASK-056).
 *
 * `itemsTotal` — это ПЛАТЁЖ ПОКУПАТЕЛЯ, а скидку по акции даёт Маркет и продавцу
 * её компенсирует. Без этого слагаемого июль на боевом магазине дал маржу 4 %
 * вместо 22 % — 421 тыс. ₽ выручки просто не считались.
 */
describe('Субсидии Маркета — это выручка продавца', () => {
  /** Заказ: покупатель заплатил 10 000, Маркет доплатил 2 000 по акции. */
  const WITH_SUBSIDY = {
    id: 7,
    itemsTotal: 10000,
    items: [{ offerId: 'A1', count: 1 }],
    subsidies: [
      { type: 'SUBSIDY', amount: 1500 },
      { type: 'YANDEX_CASHBACK', amount: 500 },
    ],
  };

  it('субсидия попадает в продажи, а не пропадает', () => {
    const totals = profitOf([WITH_SUBSIDY], COSTS);

    expect(totals.revenue).toBe(12000);
    expect(totals.subsidies).toBe(2000);
    // 12 000 − 23% − 7% − 5 000 закупа = 3 400.
    expect(totals.net).toBe(3400);
  });

  it('комиссия и налог считаются С СУБСИДИЕЙ: Маркет берёт их с полной цены', () => {
    const totals = profitOf([WITH_SUBSIDY], COSTS);

    expect(totals.commission).toBe(2760);
    expect(totals.tax).toBe(840);
  });

  it('субсидия за доставку в товарную выручку не идёт', () => {
    // Это вознаграждение за ДОСТАВКУ. Тот же принцип, по которому itemsTotal
    // не включает deliveryTotal.
    const totals = profitOf(
      [{ ...WITH_SUBSIDY, subsidies: [{ type: 'DELIVERY', amount: 900 }] }],
      COSTS,
    );

    expect(totals.revenue).toBe(10000);
    expect(totals.subsidies).toBe(0);
  });

  it('заказ без субсидий считается как раньше', () => {
    const totals = profitOf([ORDER], COSTS);

    expect(totals.revenue).toBe(10000);
    expect(totals.subsidies).toBe(0);
  });

  it('в отчёте субсидии названы прямо — иначе расхождение с «Выкуплено» выглядит ошибкой', () => {
    const text = formatProfitReport({
      period: DEFAULT_PERIOD,
      pricesUpdatedAt: new Date('2026-07-29T09:00:00Z'),
      cancelledOrders: 0,
      totals: profitOf([WITH_SUBSIDY], COSTS),
      placed: profitOf([], COSTS),
    });

    expect(text).toContain('субсидии Маркета');
    expect(text).toContain(formatRubles(2000));
  });
});

/**
 * Два набора заказов в одном отчёте (TASK-055).
 *
 * Продавец сверяется с кабинетом, где видит ОФОРМЛЕННЫЕ заказы, а прибыль
 * считалась по ВЫКУПЛЕННЫМ: 30-07-2026 это дало 11 против 10 при дневной норме
 * магазина 40–50, и отчёт выглядел сломанным. Теперь печатаются обе цифры —
 * и главное, что наборы РАЗНЫЕ, а не целое и часть.
 */
describe('Прибыль: оформленные и выкупленные вместе', () => {
  const base = {
    period: DEFAULT_PERIOD,
    pricesUpdatedAt: new Date('2026-07-29T09:00:00Z'),
    cancelledOrders: 0,
  };

  /** Оформленный заказ — другой товар и другой id, чтобы наборы не совпадали. */
  const PLACED_ORDER = {
    id: 2,
    itemsTotal: 20000,
    items: [{ offerId: 'A1', count: 2 }],
  };

  it('печатает оба набора и говорит, что заказы разные', () => {
    const text = formatProfitReport({
      ...base,
      totals: profitOf([ORDER], COSTS),
      placed: profitOf([PLACED_ORDER], COSTS),
    });

    expect(text).toContain('Оформлено');
    expect(text).toContain('Выкуплено');
    expect(text).toContain('Это другие заказы');
  });

  it('разбивка достаётся оформленным, выкупленные идут строкой', () => {
    // Два одинаковых столбца вычитаний подряд читаются как ошибка отчёта.
    const text = formatProfitReport({
      ...base,
      totals: profitOf([ORDER], COSTS),
      placed: profitOf([PLACED_ORDER], COSTS),
    });

    expect(text).toContain('Ожидается чистая');
    expect(text.match(/Комиссия/g)).toHaveLength(1);
    // Именно строка вычитания: ниже есть ещё «💵 Закуп: прайс от …» — это подпись.
    expect(text.match(/➖ Закуп:/g)).toHaveLength(1);
  });

  it('без оформленных разбивку получают выкупленные', () => {
    // Иначе отчёт за прошедший день схлопнулся бы в одну строку и продавец
    // потерял бы комиссию, налог и закуп — то, ради чего его и открывают.
    const text = formatProfitReport({
      ...base,
      totals: profitOf([ORDER], COSTS),
      placed: profitOf([], COSTS),
    });

    expect(text).toContain('Комиссия 23%');
    expect(text).toContain('Чистая');
    expect(text).not.toContain('Ожидается чистая');
    expect(text).not.toContain('Это другие заказы');
  });

  it('отменённые названы отдельно — в кабинете продавец их видит', () => {
    const text = formatProfitReport({
      ...base,
      cancelledOrders: 2,
      totals: profitOf([], COSTS),
      placed: profitOf([PLACED_ORDER], COSTS),
    });

    expect(text).toContain('Отменено');
    expect(text).toContain('в расчёт не входят');
  });

  it('заказы без закупа — один блок на оба набора, без повторов артикулов', () => {
    const unknown = { itemsTotal: 7000, items: [{ offerId: 'НЕТ-В-ПРАЙСЕ', count: 1 }] };
    const text = formatProfitReport({
      ...base,
      totals: profitOf([{ ...unknown, id: 3 }], COSTS),
      placed: profitOf([PLACED_ORDER, { ...unknown, id: 4 }], COSTS),
    });

    expect(text.match(/Не учтено заказов/g)).toHaveLength(1);
    expect(text.match(/НЕТ-В-ПРАЙСЕ/g)).toHaveLength(1);
    // Считаются оба набора: 7000 + 7000.
    expect(text).toContain(formatRubles(14000));
  });

  it('пусто во всех наборах — это результат, а не ошибка', () => {
    const text = formatProfitReport({
      ...base,
      totals: profitOf([], COSTS),
      placed: profitOf([], COSTS),
    });

    expect(text).toContain('заказов нет');
    expect(text).not.toContain('Оформлено');
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

/**
 * Комиссия за продвижение (промо) в прибыли.
 *
 * Начисляется ПО ПОЗИЦИЯМ выкупленных заказов — ставка бренда от цены товара
 * (promo.ts), в отличие от комиссии и налога, которые берутся от агрегата.
 * Ошибка здесь того же класса, что у остальной формулы: правдоподобное неверное
 * число, поэтому проверяется каждое правило отдельно.
 */
describe('Продвижение в прибыли', () => {
  // Строки закупа: по названию и категории определяется бренд позиции.
  const ROWS = new Map([
    ['C1', { price: 1000, name: 'CASIO A168', category: 'CASIO' }],
    ['V1', { price: 500, name: 'Восток Амфибия 420831', category: 'Восток' }],
  ]);
  const PROMO_COSTS = new Map([
    ['C1', 900],
    ['V1', 480],
  ]);

  const flatRates = {
    ...DEFAULT_RATES,
    promoCommissions: { casio: { mode: 'flat', percent: 2 } },
  };

  const tieredRates = {
    ...DEFAULT_RATES,
    promoCommissions: { casio: { mode: 'tiered', limit: 10000, below: 2, above: 1 } },
  };

  it('плоская ставка: процент от цены позиции, умноженный на количество', () => {
    const order = {
      id: 1,
      itemsTotal: 8000,
      items: [{ offerId: 'C1', count: 2, price: 4000 }],
    };
    const totals = profitOf([order], PROMO_COSTS, flatRates, { rows: ROWS });

    // 4000 × 2 шт × 2 % = 160.
    expect(totals.promo).toBe(160);
    expect(totals.net).toBe(
      totals.revenue - totals.commission - totals.tax - 160 - totals.purchase,
    );
  });

  it('ступени: до порога — нижняя ставка, свыше — верхняя', () => {
    const orders = [
      { id: 1, itemsTotal: 4000, items: [{ offerId: 'C1', count: 1, price: 4000 }] },
      { id: 2, itemsTotal: 12000, items: [{ offerId: 'C1', count: 1, price: 12000 }] },
    ];
    const totals = profitOf(orders, PROMO_COSTS, tieredRates, { rows: ROWS });

    // 4000 × 2 % + 12000 × 1 % = 80 + 120 = 200.
    expect(totals.promo).toBe(200);
  });

  it('граница ВКЛЮЧИТЕЛЬНО: цена, равная порогу, идёт по нижней ставке', () => {
    const order = { id: 1, itemsTotal: 10000, items: [{ offerId: 'C1', count: 1, price: 10000 }] };
    const totals = profitOf([order], PROMO_COSTS, tieredRates, { rows: ROWS });

    expect(totals.promo).toBe(200); // 10 000 × 2 %, а не × 1 %
  });

  it('порог сравнивается с ценой ЗА ЕДИНИЦУ, а не со строкой заказа', () => {
    // Две штуки по 6 000 ₽ — это 12 000 ₽ строки, но каждая единица дешевле
    // порога и идёт по нижней ставке.
    const order = { id: 1, itemsTotal: 12000, items: [{ offerId: 'C1', count: 2, price: 6000 }] };
    const totals = profitOf([order], PROMO_COSTS, tieredRates, { rows: ROWS });

    expect(totals.promo).toBe(240); // 6000 × 2 × 2 %
  });

  it('бренд без настройки — 0 %: продвижение opt-in', () => {
    const order = { id: 1, itemsTotal: 500, items: [{ offerId: 'V1', count: 1, price: 500 }] };
    const totals = profitOf([order], PROMO_COSTS, flatRates, { rows: ROWS });

    expect(totals.promo).toBe(0);
  });

  it('позиция без цены даёт ноль промо, а не ломает расчёт', () => {
    const order = { id: 1, itemsTotal: 4000, items: [{ offerId: 'C1', count: 1 }] };
    const totals = profitOf([order], PROMO_COSTS, flatRates, { rows: ROWS });

    expect(totals.promo).toBe(0);
    expect(totals.orders).toBe(1);
  });

  it('возврат и заказ без закупа промо не набирают', () => {
    const returnedOrder = {
      id: 7,
      itemsTotal: 4000,
      items: [{ offerId: 'C1', count: 1, price: 4000 }],
    };
    const unknownOrder = {
      id: 8,
      itemsTotal: 4000,
      items: [{ offerId: 'НЕТ-В-ПРАЙСЕ', count: 1, price: 4000 }],
    };
    const totals = profitOf([returnedOrder, unknownOrder], PROMO_COSTS, flatRates, {
      rows: ROWS,
      returned: new Set([7]),
    });

    expect(totals.promo).toBe(0);
  });

  it('без настроек продвижения промо ноль и чистая как раньше (регресс)', () => {
    const withRows = profitOf([ORDER], COSTS, DEFAULT_RATES, { rows: ROWS });
    const without = profitOf([ORDER], COSTS, DEFAULT_RATES);

    expect(withRows.promo).toBe(0);
    expect(withRows.net).toBe(without.net);
    expect(without.promo).toBe(0);
  });

  it('без строк закупа промо честно ноль: бренд позиции не определить', () => {
    const order = { id: 1, itemsTotal: 4000, items: [{ offerId: 'C1', count: 1, price: 4000 }] };
    const totals = profitOf([order], PROMO_COSTS, flatRates);

    expect(totals.promo).toBe(0);
  });

  it('мусорная настройка выкидывается по-записно, не роняя отчёт', () => {
    const order = { id: 1, itemsTotal: 4000, items: [{ offerId: 'C1', count: 1, price: 4000 }] };
    const totals = profitOf(
      [order],
      PROMO_COSTS,
      { ...DEFAULT_RATES, promoCommissions: { casio: { mode: 'tiered', limit: -1 } } },
      { rows: ROWS },
    );

    expect(totals.promo).toBe(0);
    expect(totals.orders).toBe(1);
  });

  it('в тексте отчёта промо видно строкой и ставками, а без настройки — нет', () => {
    const order = { id: 1, itemsTotal: 4000, items: [{ offerId: 'C1', count: 1, price: 4000 }] };
    const totals = profitOf([order], PROMO_COSTS, flatRates, { rows: ROWS });

    const withPromo = formatProfitReport({
      period: DEFAULT_PERIOD,
      pricesUpdatedAt: new Date('2026-07-29T09:00:00Z'),
      totals,
    });

    expect(withPromo).toContain('➖ Продвижение');
    expect(withPromo).toContain(formatRubles(80)); // 4000 × 2 %
    // Ставки проверяемы: настроенный бренд перечислен в хвосте.
    expect(withPromo).toContain('📣 Продвижение: CASIO 2%');

    const withoutPromo = formatProfitReport({
      period: DEFAULT_PERIOD,
      pricesUpdatedAt: new Date('2026-07-29T09:00:00Z'),
      totals: profitOf([order], PROMO_COSTS, DEFAULT_RATES, { rows: ROWS }),
    });

    expect(withoutPromo).not.toContain('Продвижение');
  });
});
