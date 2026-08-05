import { describe, it, expect } from 'vitest';

import { BRAND_KEYS } from '../../src/modules/yandex/reports/brands';
import {
  PROMO_CB_CANCEL,
  PROMO_CB_MENU,
  PROMO_CB_PATTERN,
  parsePromoCallback,
  parsePromoLimit,
  parsePromoPending,
  promoCallback,
  promoConfigsOf,
  promoPendingValue,
  promoPercentAt,
  promoPercentTitle,
  promoShortValue,
  promoStepTitle,
  promoTitle,
  promoValueLabel,
  promoWithFloor,
  validatePromoFrom,
  validatePromoLimit,
} from '../../src/modules/yandex/reports/promo';
import type { TPromoConfig, TPromoPending } from '../../src/modules/yandex/reports/promo';

const FLAT: TPromoConfig = { mode: 'flat', percent: 2 };
const TIERED: TPromoConfig = { mode: 'tiered', limit: 10000, below: 2, above: 1 };
const FLAT_FROM: TPromoConfig = { mode: 'flat', percent: 2, from: 3000 };
const TIERED_FROM: TPromoConfig = { ...TIERED, from: 3000 };

describe('promoPercentAt', () => {
  it('плоская ставка не зависит от цены', () => {
    expect(promoPercentAt(FLAT, 100)).toBe(2);
    expect(promoPercentAt(FLAT, 1000000)).toBe(2);
  });

  it('ступени: до порога — below, свыше — above', () => {
    expect(promoPercentAt(TIERED, 9999)).toBe(2);
    expect(promoPercentAt(TIERED, 10001)).toBe(1);
  });

  it('граница ВКЛЮЧИТЕЛЬНО: цена, равная порогу, идёт по нижней ставке', () => {
    // «до 10 000 ₽» читается как «10 000 ₽ ещё считается дешёвым». Сдвиг этой
    // границы молча меняет расход продвижения в отчёте — поэтому тест.
    expect(promoPercentAt(TIERED, 10000)).toBe(2);
    expect(promoPercentAt(TIERED, 10000.01)).toBe(1);
  });

  it('нижний порог: дешевле — 0%, на пороге ВКЛЮЧИТЕЛЬНО — ставка', () => {
    // «от 3 000 ₽» читается как «3 000 ₽ уже продвигается» — зеркально
    // включительной границе ступеней.
    expect(promoPercentAt(FLAT_FROM, 2999.99)).toBe(0);
    expect(promoPercentAt(FLAT_FROM, 3000)).toBe(2);
    expect(promoPercentAt(FLAT_FROM, 5000)).toBe(2);
  });

  it('нижний порог поверх ступеней: сначала порог, потом ступень', () => {
    expect(promoPercentAt(TIERED_FROM, 2000)).toBe(0);
    expect(promoPercentAt(TIERED_FROM, 5000)).toBe(2);
    expect(promoPercentAt(TIERED_FROM, 12000)).toBe(1);
  });

  it('порог выше лимита ступени — когерентно: порог срабатывает первым', () => {
    // Настройка странная, но представимая; поведение задано порядком проверок
    // в promoPercentAt и пинится здесь, а не запрещается валидацией.
    const odd: TPromoConfig = { mode: 'tiered', limit: 10000, below: 2, above: 1, from: 15000 };
    expect(promoPercentAt(odd, 12000)).toBe(0);
    expect(promoPercentAt(odd, 15000)).toBe(1);
  });
});

describe('promoConfigsOf', () => {
  it('валидные записи обеих форм проходят', () => {
    const configs = promoConfigsOf({ casio: FLAT, vostok: TIERED });

    expect(configs.casio).toEqual(FLAT);
    expect(configs.vostok).toEqual(TIERED);
  });

  it('мусорная запись выкидывается по одной, не роняя остальных', () => {
    const configs = promoConfigsOf({
      casio: FLAT,
      orient: { mode: 'flat', percent: 500 },
      seiko: { mode: 'tiered', limit: -1, below: 2, above: 1 },
      vostok: { mode: 'tiered', limit: 10000, below: Number('не число'), above: 1 },
      sever: { mode: 'нет-такого-режима', percent: 2 },
      rolex: FLAT,
    });

    expect(configs.casio).toEqual(FLAT);
    expect(configs.orient).toBeUndefined();
    expect(configs.seiko).toBeUndefined();
    expect(configs.vostok).toBeUndefined();
    expect(configs.sever).toBeUndefined();
    expect('rolex' in configs).toBe(false);
  });

  it('ноль процентов — валидная явная ставка, а не «нет записи»', () => {
    const configs = promoConfigsOf({ casio: { mode: 'flat', percent: 0 } });
    expect(configs.casio).toEqual({ mode: 'flat', percent: 0 });
  });

  it('нижний порог проходит в обеих формах и не появляется, когда его нет', () => {
    const configs = promoConfigsOf({ casio: FLAT_FROM, vostok: TIERED_FROM, orient: FLAT });

    expect(configs.casio).toStrictEqual(FLAT_FROM);
    expect(configs.vostok).toStrictEqual(TIERED_FROM);
    // Ключ `from: undefined` не должен появляться: toEqual его скроет, а в $set
    // он уехал бы как есть.
    expect('from' in configs.orient).toBe(false);
  });

  it('мусорный нижний порог роняет запись целиком, а не игнорируется', () => {
    // Молча посчитать без порога — значит начислить продвижение там, где
    // продавец его отключил, и занизить прибыль незаметно. «—» на экране видно.
    for (const from of [-5, 0, 'три тысячи', Number.NaN, null]) {
      const configs = promoConfigsOf({ casio: { ...FLAT, from }, vostok: TIERED });
      expect(configs.casio).toBeUndefined();
      expect(configs.vostok).toStrictEqual(TIERED);
    }
  });

  it('пустой и отсутствующий вход — пустая карта', () => {
    expect(promoConfigsOf(undefined)).toEqual({});
    expect(promoConfigsOf(null)).toEqual({});
    expect(promoConfigsOf({})).toEqual({});
  });
});

describe('callback_data продвижения', () => {
  it('разбирается обратно и укладывается в лимит Telegram', () => {
    for (const key of BRAND_KEYS) {
      for (const action of ['pick', 'flat', 'tier', 'off', 'floor'] as const) {
        const data = promoCallback(action, key);
        expect(parsePromoCallback(data)).toEqual({ kind: action, brand: key });
        // Лимит Telegram на callback_data — 64 байта.
        expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
      }
    }

    expect(parsePromoCallback(PROMO_CB_MENU)).toEqual({ kind: 'menu' });
    expect(parsePromoCallback(PROMO_CB_CANCEL)).toEqual({ kind: 'cancel' });
  });

  it('паттерн заякорен: чужое и похожее не матчится', () => {
    expect(parsePromoCallback('xpromo:menu')).toBeNull();
    expect(parsePromoCallback('promo:menu:extra')).toBeNull();
    expect(parsePromoCallback('promo:pick:rolex')).toBeNull();
    expect(parsePromoCallback('promo:zzz:casio')).toBeNull();
    expect(parsePromoCallback('bdisc:casio')).toBeNull();
    expect(parsePromoCallback('')).toBeNull();
    expect(PROMO_CB_PATTERN.test('promo:pick:casio ')).toBe(false);
  });
});

describe('pendingRate продвижения: пошаговая цепочка', () => {
  /** Все пять шагов одного бренда — цепочка целиком, обе ветки. */
  const STEPS = (brand: TPromoPending['brand']): TPromoPending[] => [
    { brand, step: 'from', mode: 'flat' },
    { brand, step: 'from', mode: 'tier' },
    { brand, step: 'flat', from: 3000 },
    { brand, step: 'limit', from: 3000 },
    { brand, step: 'below', from: 3000, limit: 10000 },
    { brand, step: 'above', from: 3000, limit: 10000, below: 2 },
  ];

  it('кодек каждого шага ходит туда и обратно', () => {
    for (const key of BRAND_KEYS) {
      for (const step of STEPS(key)) {
        expect(parsePromoPending(promoPendingValue(step))).toEqual(step);
      }
    }
  });

  it('нижний порог едет в строке, и ноль тоже', () => {
    // Ноль — «порога нет». В базу он не попадает, но в незакрытом вопросе живёт
    // как обычное значение: иначе следующий шаг не знал бы, что уже спросили.
    expect(promoPendingValue({ brand: 'casio', step: 'flat', from: 0 })).toBe('promo:casio:flat:0');
    expect(parsePromoPending('promo:casio:flat:0')).toEqual({
      brand: 'casio',
      step: 'flat',
      from: 0,
    });
  });

  it('дробные значения переживают сериализацию', () => {
    const step: TPromoPending = {
      brand: 'casio',
      step: 'above',
      from: 2999.5,
      limit: 9999.5,
      below: 2.5,
    };
    expect(parsePromoPending(promoPendingValue(step))).toEqual(step);
  });

  it('ЛЕГАСИ: формы без нижнего порога читаются как «порога нет»', () => {
    // Вопрос, открытый до появления порога. Вернуть null было бы хуже: pendingRate
    // остался бы висеть в базе, а ответ уехал бы в визард с «Не понял, что нужно».
    expect(parsePromoPending('promo:casio:flat')).toEqual({ brand: 'casio', step: 'flat', from: 0 });
    expect(parsePromoPending('promo:casio:limit')).toEqual({
      brand: 'casio',
      step: 'limit',
      from: 0,
    });
    expect(parsePromoPending('promo:casio:below:10000')).toEqual({
      brand: 'casio',
      step: 'below',
      from: 0,
      limit: 10000,
    });
    expect(parsePromoPending('promo:casio:above:10000:2')).toEqual({
      brand: 'casio',
      step: 'above',
      from: 0,
      limit: 10000,
      below: 2,
    });
  });

  it('форма кнопочной итерации «promo:<ключ>:from» вопросом не считается', () => {
    // Кнопка «📏 Нижний порог» прожила один релиз и порог не задавала никогда.
    expect(parsePromoPending('promo:casio:from')).toBeNull();
  });

  it('мусор — null: испорченная строка закрывает вопрос, а не доживает до $set', () => {
    expect(parsePromoPending('promo:rolex:limit:0')).toBeNull();
    // Number('') === 0 — пустой хвост не должен стать валидным нулевым порогом.
    expect(parsePromoPending('promo:casio:flat:')).toBeNull();
    expect(parsePromoPending('promo:casio:flat:-5')).toBeNull();
    expect(parsePromoPending('promo:casio:from:zzz')).toBeNull();
    expect(parsePromoPending('promo:casio:from:flat:3000')).toBeNull();
    expect(parsePromoPending('promo:casio:below:0:abc')).toBeNull();
    expect(parsePromoPending('promo:casio:below:0:-5')).toBeNull();
    expect(parsePromoPending('promo:casio:above:0:10000:500')).toBeNull();
    expect(parsePromoPending('promo:casio:zzz')).toBeNull();
    expect(parsePromoPending('promo:casio:flat:0:extra')).toBeNull();
    expect(parsePromoPending('brand:casio')).toBeNull();
    expect(parsePromoPending('commissionPercent')).toBeNull();
    expect(parsePromoPending(undefined)).toBeNull();
    expect(parsePromoPending(null)).toBeNull();
  });

  it('callback-строки той же фичи pending-вопросом не считаются', () => {
    // Префикс общий нарочно (одна фича), но вторым сегментом у pending всегда
    // ключ бренда — «promo:pick:casio» из кнопки не должен открыть вопрос.
    expect(parsePromoPending('promo:pick:casio')).toBeNull();
    expect(parsePromoPending('promo:floor:casio')).toBeNull();
    expect(parsePromoPending('promo:menu')).toBeNull();
    expect(parsePromoPending('promo:cancel')).toBeNull();
  });
});

describe('Нумерация шагов', () => {
  it('общий процент — два шага, ступени — четыре', () => {
    expect(promoStepTitle({ brand: 'casio', step: 'from', mode: 'flat' })).toBe('Шаг 1 из 2.');
    expect(promoStepTitle({ brand: 'casio', step: 'flat', from: 0 })).toBe('Шаг 2 из 2.');

    expect(promoStepTitle({ brand: 'casio', step: 'from', mode: 'tier' })).toBe('Шаг 1 из 4.');
    expect(promoStepTitle({ brand: 'casio', step: 'limit', from: 0 })).toBe('Шаг 2 из 4.');
    expect(promoStepTitle({ brand: 'casio', step: 'below', from: 0, limit: 10000 })).toBe(
      'Шаг 3 из 4.',
    );
    expect(
      promoStepTitle({ brand: 'casio', step: 'above', from: 0, limit: 10000, below: 2 }),
    ).toBe('Шаг 4 из 4.');
  });

  it('нижний порог — первый вопрос ОБЕИХ цепочек', () => {
    // Ради этого фича и переделывалась: кнопкой порог не задавался никогда.
    for (const mode of ['flat', 'tier'] as const) {
      expect(promoStepTitle({ brand: 'casio', step: 'from', mode })).toMatch(/^Шаг 1 из/);
    }
  });
});

describe('promoWithFloor', () => {
  it('ноль порога ключа from не оставляет', () => {
    // Хранимый from: 0 promoConfigsOf считает мусором и выкидывает запись
    // целиком — значит ноль обязан исчезнуть на пути записи.
    const written = promoWithFloor(FLAT, 0);
    expect(written).toStrictEqual(FLAT);
    expect('from' in written).toBe(false);
  });

  it('порог больше нуля дописывается в обе формы', () => {
    expect(promoWithFloor(FLAT, 3000)).toStrictEqual(FLAT_FROM);
    expect(promoWithFloor(TIERED, 3000)).toStrictEqual(TIERED_FROM);
  });

  it('записанное promoWithFloor переживает promoConfigsOf', () => {
    // Проверка сквозная: правило «мусорный from роняет запись» не должно
    // срабатывать на том, что пишем мы сами.
    expect(promoConfigsOf({ casio: promoWithFloor(FLAT, 0) }).casio).toStrictEqual(FLAT);
    expect(promoConfigsOf({ casio: promoWithFloor(FLAT, 3000) }).casio).toStrictEqual(FLAT_FROM);
  });
});

describe('parsePromoLimit', () => {
  it('принимает сумму, как её пишут руками', () => {
    expect(parsePromoLimit('10000')).toBe(10000);
    expect(parsePromoLimit('10 000')).toBe(10000);
    expect(parsePromoLimit('10 000 ₽')).toBe(10000);
    expect(parsePromoLimit('10000 ₽')).toBe(10000);
    expect(parsePromoLimit(' 9999,5 ')).toBe(9999.5);
  });

  it('дата и время не матчатся: открытый промо-вопрос не глушит соседние', () => {
    // «28-07-2026» — ответ на вопрос о дне отчёта, «09:00» — о времени
    // рассылки; оба должны пройти мимо и дойти до своих обработчиков.
    expect(parsePromoLimit('28-07-2026')).toBeNull();
    expect(parsePromoLimit('09:00')).toBeNull();
    expect(parsePromoLimit('десять тысяч')).toBeNull();
    expect(parsePromoLimit('')).toBeNull();
  });

  it('порог валидируется: ноль и меньше — отказ с подсказкой', () => {
    expect(validatePromoLimit(10000).ok).toBe(true);
    expect(validatePromoLimit(0).ok).toBe(false);
    expect(validatePromoLimit(-5).ok).toBe(false);
    expect(validatePromoLimit(Number.NaN).ok).toBe(false);
    expect(validatePromoLimit(0).error).toBeTruthy();
  });

  it('нижний порог принимает ноль — это ответ «убрать порог»', () => {
    expect(validatePromoFrom(3000).ok).toBe(true);
    expect(validatePromoFrom(0).ok).toBe(true);
    expect(validatePromoFrom(-5).ok).toBe(false);
    expect(validatePromoFrom(Number.NaN).ok).toBe(false);
    // Подсказка обязана называть способ снять порог — другого пути нет.
    expect(validatePromoFrom(-5).error).toContain('0');
    expect(parsePromoLimit('0')).toBe(0);
  });
});

describe('Подписи', () => {
  it('полная форма: обе конфигурации и «не настроено»', () => {
    expect(promoValueLabel(FLAT)).toBe('2%');
    // NBSP и в разрядах, и перед ₽ — идиома formatRubles; escape, чтобы был виден.
    expect(promoValueLabel(TIERED)).toBe('до 10\u00a0000\u00a0₽ — 2%, свыше — 1%');
    expect(promoValueLabel(undefined)).toBe('—');
  });

  it('полная форма показывает нижний порог префиксом', () => {
    expect(promoValueLabel(FLAT_FROM)).toBe('от 3\u00a0000\u00a0₽: 2%');
    expect(promoValueLabel(TIERED_FROM)).toBe(
      'от 3\u00a0000\u00a0₽: до 10\u00a0000\u00a0₽ — 2%, свыше — 1%',
    );
  });

  it('короткая форма для кнопки', () => {
    expect(promoShortValue(FLAT)).toBe('2%');
    expect(promoShortValue(TIERED)).toBe('2/1%');
    expect(promoShortValue(undefined)).toBe('—');
  });

  it('короткая форма порог не показывает — как не показывает и лимит ступеней', () => {
    // В ряду из двух кнопок Telegram обрезает длинные подписи; полная форма
    // печатается в тексте экрана строкой выше.
    expect(promoShortValue(FLAT_FROM)).toBe('2%');
    expect(promoShortValue(TIERED_FROM)).toBe('2/1%');
  });

  it('названия для подтверждений и ошибок содержат бренд', () => {
    for (const key of BRAND_KEYS) {
      expect(promoTitle(key)).toContain('«');
      expect(promoPercentTitle(key, 'flat')).toBe(promoTitle(key));
      expect(promoPercentTitle(key, 'below')).toContain('до порога');
      expect(promoPercentTitle(key, 'above')).toContain('свыше порога');
    }
  });
});
