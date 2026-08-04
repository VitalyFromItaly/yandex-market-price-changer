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
  promoPendingAbove,
  promoPendingBelow,
  promoPendingFlat,
  promoPendingLimit,
  promoPercentAt,
  promoPercentTitle,
  promoShortValue,
  promoTitle,
  promoValueLabel,
  validatePromoLimit,
} from '../../src/modules/yandex/reports/promo';
import type { TPromoConfig } from '../../src/modules/yandex/reports/promo';

const FLAT: TPromoConfig = { mode: 'flat', percent: 2 };
const TIERED: TPromoConfig = { mode: 'tiered', limit: 10000, below: 2, above: 1 };

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

  it('пустой и отсутствующий вход — пустая карта', () => {
    expect(promoConfigsOf(undefined)).toEqual({});
    expect(promoConfigsOf(null)).toEqual({});
    expect(promoConfigsOf({})).toEqual({});
  });
});

describe('callback_data продвижения', () => {
  it('разбирается обратно и укладывается в лимит Telegram', () => {
    for (const key of BRAND_KEYS) {
      for (const action of ['pick', 'flat', 'tier', 'off'] as const) {
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
  it('кодек каждого шага ходит туда и обратно', () => {
    for (const key of BRAND_KEYS) {
      expect(parsePromoPending(promoPendingFlat(key))).toEqual({ brand: key, step: 'flat' });
      expect(parsePromoPending(promoPendingLimit(key))).toEqual({ brand: key, step: 'limit' });
      expect(parsePromoPending(promoPendingBelow(key, 10000))).toEqual({
        brand: key,
        step: 'below',
        limit: 10000,
      });
      expect(parsePromoPending(promoPendingAbove(key, 10000, 2))).toEqual({
        brand: key,
        step: 'above',
        limit: 10000,
        below: 2,
      });
    }
  });

  it('дробные значения переживают сериализацию', () => {
    expect(parsePromoPending(promoPendingAbove('casio', 9999.5, 2.5))).toEqual({
      brand: 'casio',
      step: 'above',
      limit: 9999.5,
      below: 2.5,
    });
  });

  it('мусор — null: испорченная строка закрывает вопрос, а не доживает до $set', () => {
    expect(parsePromoPending('promo:rolex:limit')).toBeNull();
    expect(parsePromoPending('promo:casio:below:abc')).toBeNull();
    expect(parsePromoPending('promo:casio:below:-5')).toBeNull();
    expect(parsePromoPending('promo:casio:above:10000:500')).toBeNull();
    expect(parsePromoPending('promo:casio:zzz')).toBeNull();
    expect(parsePromoPending('promo:casio:flat:extra')).toBeNull();
    expect(parsePromoPending('brand:casio')).toBeNull();
    expect(parsePromoPending('commissionPercent')).toBeNull();
    expect(parsePromoPending(undefined)).toBeNull();
    expect(parsePromoPending(null)).toBeNull();
  });

  it('callback-строки той же фичи pending-вопросом не считаются', () => {
    // Префикс общий нарочно (одна фича), но вторым сегментом у pending всегда
    // ключ бренда — «promo:pick:casio» из кнопки не должен открыть вопрос.
    expect(parsePromoPending('promo:pick:casio')).toBeNull();
    expect(parsePromoPending('promo:menu')).toBeNull();
    expect(parsePromoPending('promo:cancel')).toBeNull();
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
});

describe('Подписи', () => {
  it('полная форма: обе конфигурации и «не настроено»', () => {
    expect(promoValueLabel(FLAT)).toBe('2%');
    // NBSP и в разрядах, и перед ₽ — идиома formatRubles; escape, чтобы был виден.
    expect(promoValueLabel(TIERED)).toBe('до 10\u00a0000\u00a0₽ — 2%, свыше — 1%');
    expect(promoValueLabel(undefined)).toBe('—');
  });

  it('короткая форма для кнопки', () => {
    expect(promoShortValue(FLAT)).toBe('2%');
    expect(promoShortValue(TIERED)).toBe('2/1%');
    expect(promoShortValue(undefined)).toBe('—');
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
