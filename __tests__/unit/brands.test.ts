import { describe, it, expect } from 'vitest';

import {
  BRAND_CB_CANCEL,
  BRAND_CB_MENU,
  BRAND_KEYS,
  brandCallback,
  brandDiscountTitle,
  brandInputLabel,
  brandOf,
  brandPendingValue,
  brandTitle,
  isBrandKey,
  parseBrandCallback,
  parseBrandDiscountInput,
  parseBrandPending,
} from '../../src/modules/yandex/reports/brands';
import {
  DEFAULT_DISCOUNT_PERCENT,
  DEFAULT_VOSTOK_DISCOUNT_PERCENT,
  brandDiscountOf,
  discountsOf,
} from '../../src/modules/yandex/reports/profit';
import { BRAND_PREFIXES } from '../../src/modules/yandex/stocks/sku-resolver';

/**
 * Определение бренда.
 *
 * Ошибка здесь не роняет ничего — она молча меняет процент закупа, по которому
 * продавец принимает решения. Кейсы «Востока» перенесены из profit.test.ts
 * дословно: поведение старого discountGroup обязано воспроизводиться.
 */
describe('brandOf', () => {
  it('«Восток» узнаётся и по категории, и по названию — весь завод один бренд', () => {
    expect(brandOf({ category: 'Восток' })).toBe('vostok');
    expect(brandOf({ category: 'Командирские' })).toBe('vostok');
    expect(brandOf({ category: 'Партнер' })).toBe('vostok');
    // «Амфибия» отдельной категорией не идёт — она внутри «Востока», но видна
    // в наименовании.
    expect(brandOf({ name: 'Восток Амфибия 420831' })).toBe('vostok');
    expect(brandOf({ name: 'Командирские 350501 К-35' })).toBe('vostok');
  });

  it('остальные бренды узнаются по своим маркерам', () => {
    expect(brandOf({ category: 'ORIENT кварцевые', name: 'ORIENT FAA02006M' })).toBe('orient');
    expect(brandOf({ category: 'CASIO COLLECTION' })).toBe('casio');
    expect(brandOf({ name: 'SEIKO SUR343P1' })).toBe('seiko');
    expect(brandOf({ name: 'Daniel Klein 14081-4' })).toBe('daniel-klein');
    expect(brandOf({ category: 'СЕВЕР Спорт' })).toBe('sever');
  });

  it('ничья позиция — null, то есть общая скидка', () => {
    expect(brandOf({})).toBeNull();
    expect(brandOf({ category: '(без категории)', name: 'Луч 78297600' })).toBeNull();
  });

  it('исключения «Востока» действуют: Кремлёвские, Брайлевские, Мегаполис — не Восток', () => {
    // Решение заказчика: эти линейки идут по общей скидке, хотя завод тот же.
    // «Восток Кремлёвские» — реальная категория из stock.xlsx: по слову
    // «Восток» она получила бы 4 % — ровно наоборот решению.
    expect(brandOf({ category: 'Восток Кремлёвские' })).toBeNull();
    expect(brandOf({ name: 'Кремлевские 010040' })).toBeNull();
    expect(brandOf({ name: 'Восток Брайлевские 491210' })).toBeNull();
    expect(brandOf({ name: 'Восток Мегаполис 121812' })).toBeNull();
  });

  it('порядок матчинга: «Восток» первым, чтобы никто не перехватил его строки', () => {
    expect(BRAND_KEYS[0]).toBe('vostok');
    // Название, где есть и восточный маркер, и чужой, — это «Восток».
    expect(brandOf({ name: 'Восток Север 123' })).toBe('vostok');
  });

  /**
   * Дрейф-страж: реестр брендов и BRAND_PREFIXES из sku-resolver — РАЗНЫЕ
   * списки с разными задачами (скидка и разрешение артикула), и сливать их
   * нельзя. Но каждый бренд, чьи названия мы умеем чистить, обязан узнаваться
   * и скидкой — иначе появление нового префикса молча уронит его позиции в
   * «Остальные».
   */
  it('каждый префикс из sku-resolver разрешается в бренд', () => {
    for (const prefix of BRAND_PREFIXES) {
      expect(brandOf({ name: `${prefix} 12345` }), prefix).not.toBeNull();
    }
  });
});

describe('Цепочка фолбэков скидки', () => {
  it('явная запись карты сильнее всего, дефолт — для брендов без записи', () => {
    const config = discountsOf({ discountPercent: 12, brandDiscounts: { casio: 5 } });

    expect(brandDiscountOf(config, 'casio')).toBe(5);
    expect(brandDiscountOf(config, 'orient')).toBe(12);
    expect(brandDiscountOf(config, null)).toBe(12);
  });

  it('ноль в карте — валидная скидка, а не «нет записи»', () => {
    const config = discountsOf({ brandDiscounts: { casio: 0 } });
    expect(brandDiscountOf(config, 'casio')).toBe(0);
  });

  it('«Восток» без записи в карте берётся из легаси-поля', () => {
    // Продавцы настроили vostokDiscountPercent до появления карты — «влить в
    // новую систему» не должно означать «потерять настройку».
    const legacy = discountsOf({ vostokDiscountPercent: 3 });
    expect(brandDiscountOf(legacy, 'vostok')).toBe(3);

    // Запись карты побеждает легаси-поле.
    const explicit = discountsOf({ vostokDiscountPercent: 3, brandDiscounts: { vostok: 6 } });
    expect(brandDiscountOf(explicit, 'vostok')).toBe(6);

    // Совсем нетронутый магазин — дефолты: 4 % «Востоку», 10 % остальным.
    const untouched = discountsOf({});
    expect(brandDiscountOf(untouched, 'vostok')).toBe(DEFAULT_VOSTOK_DISCOUNT_PERCENT);
    expect(brandDiscountOf(untouched, 'casio')).toBe(DEFAULT_DISCOUNT_PERCENT);
  });

  it('мусорная запись карты выкидывается, не роняя конфиг', () => {
    const config = discountsOf({
      brandDiscounts: {
        casio: Number('не число'),
        orient: 500,
        seiko: -1,
        неизвестный: 5,
      } as never,
    });

    expect(brandDiscountOf(config, 'casio')).toBe(DEFAULT_DISCOUNT_PERCENT);
    expect(brandDiscountOf(config, 'orient')).toBe(DEFAULT_DISCOUNT_PERCENT);
    expect(brandDiscountOf(config, 'seiko')).toBe(DEFAULT_DISCOUNT_PERCENT);
  });
});

describe('Текстовый ввод «скидка <бренд>: N»', () => {
  it('бренд и значение разбираются, как пишут люди', () => {
    expect(parseBrandDiscountInput('скидка восток: 4')).toEqual({ brand: 'vostok', value: 4 });
    expect(parseBrandDiscountInput('Скидка на Восток: 4')).toEqual({ brand: 'vostok', value: 4 });
    expect(parseBrandDiscountInput('скидка   восток : 4')).toEqual({ brand: 'vostok', value: 4 });
    expect(parseBrandDiscountInput('скидка casio: 5')).toEqual({ brand: 'casio', value: 5 });
    expect(parseBrandDiscountInput('СКИДКА CASIO: 5')).toEqual({ brand: 'casio', value: 5 });
    expect(parseBrandDiscountInput('скидка daniel klein: 7,5')).toEqual({
      brand: 'daniel-klein',
      value: 7.5,
    });
    expect(parseBrandDiscountInput('скидка сейко: 5%')).toEqual({ brand: 'seiko', value: 5 });
  });

  it('общая «скидка: 10» — не брендовая: она уходит в parseRateInput', () => {
    expect(parseBrandDiscountInput('скидка: 10')).toBeNull();
  });

  it('незнакомый бренд и чужие подписи — отказ, а не догадка', () => {
    expect(parseBrandDiscountInput('скидка rolex: 5')).toBeNull();
    expect(parseBrandDiscountInput('комиссия: 23')).toBeNull();
    expect(parseBrandDiscountInput('token: ACMA:secret')).toBeNull();
    expect(parseBrandDiscountInput('23')).toBeNull();
    expect(parseBrandDiscountInput('')).toBeNull();
  });

  it('подсказка для ввода — та самая, которую понимает парсер', () => {
    for (const key of BRAND_KEYS) {
      expect(parseBrandDiscountInput(`${brandInputLabel(key)}: 5`)).toEqual({
        brand: key,
        value: 5,
      });
    }
  });
});

describe('callback_data кнопок брендов', () => {
  it('разбирается обратно и укладывается в лимит Telegram', () => {
    for (const key of BRAND_KEYS) {
      const data = brandCallback(key);
      expect(parseBrandCallback(data)).toBe(key);
      // Лимит Telegram на callback_data — 64 байта.
      expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
    }

    expect(parseBrandCallback(BRAND_CB_MENU)).toBe('menu');
    expect(parseBrandCallback(BRAND_CB_CANCEL)).toBe('cancel');
  });

  it('ключи — ASCII-слаги и не совпадают со служебными словами', () => {
    // Ключ уходит в callback_data, в pendingRate и в $set-путь монги:
    // кириллица сломала бы лимит 64 байт, точка — путь.
    for (const key of BRAND_KEYS) {
      expect(key).toMatch(/^[a-z0-9-]+$/);
      expect(key).not.toBe('menu');
      expect(key).not.toBe('cancel');
    }
  });

  it('чужой callback_data брендом не считается', () => {
    expect(parseBrandCallback('bdisc:rolex')).toBeNull();
    expect(parseBrandCallback('rate:discountPercent')).toBeNull();
    expect(parseBrandCallback('bdisc:')).toBeNull();
    expect(parseBrandCallback('')).toBeNull();
  });
});

describe('pendingRate со значением бренда', () => {
  it('кодек ходит туда и обратно', () => {
    for (const key of BRAND_KEYS) {
      expect(parseBrandPending(brandPendingValue(key))).toBe(key);
    }
  });

  it('легаси-литерал vostokDiscountPercent разрешается в «Восток»', () => {
    // Вопрос, открытый до деплоя (ставкой «⌚ Восток»), должен разрешиться
    // ответом, а не зависнуть: такой ставки больше нет.
    expect(parseBrandPending('vostokDiscountPercent')).toBe('vostok');
  });

  it('ставки и мусор брендом не считаются', () => {
    expect(parseBrandPending('commissionPercent')).toBeNull();
    expect(parseBrandPending('discountPercent')).toBeNull();
    expect(parseBrandPending('brand:rolex')).toBeNull();
    expect(parseBrandPending('brand:')).toBeNull();
    expect(parseBrandPending(undefined)).toBeNull();
    expect(parseBrandPending(null)).toBeNull();
  });
});

describe('Реестр', () => {
  it('у каждого бренда есть название, заголовок скидки и подпись ввода', () => {
    for (const key of BRAND_KEYS) {
      expect(brandTitle(key)).toBeTruthy();
      expect(brandDiscountTitle(key)).toContain(brandTitle(key));
      expect(brandInputLabel(key).startsWith('скидка ')).toBe(true);
      expect(isBrandKey(key)).toBe(true);
    }

    expect(isBrandKey('rolex')).toBe(false);
    expect(isBrandKey(undefined)).toBe(false);
  });
});
