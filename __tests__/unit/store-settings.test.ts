import { describe, expect, it, vi } from 'vitest';

import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { discountsOf, ratesOf } from '../../src/modules/yandex/reports/profit';
import { promoConfigsOf } from '../../src/modules/yandex/reports/promo';
import {
  storeSettingsOf,
  validateProfitSettings,
  validatePromoInput,
} from '../../src/modules/yandex/settings/store-settings.domain';
import { StoreSettingsService } from '../../src/modules/yandex/settings/store-settings.service';
import { inMemoryModel } from '../helpers/in-memory-model';

const USER = '222';

function setup(seed = [{ telegramUserId: USER, commissionPercent: 23, vostokDiscountPercent: 4 }]) {
  const model = inMemoryModel(seed);
  const findOneAndUpdate = vi.spyOn(model, 'findOneAndUpdate');
  const stores = new YandexMarketService(model as never);
  const purchasePrices = {
    listNamesAndCategories: vi.fn(async () => [
      { name: 'CASIO G-Shock', category: 'Часы' },
      { name: 'Восток Амфибия', category: 'Восток' },
      { name: 'Безымянные', category: 'Прочее' },
    ]),
  };
  const service = new StoreSettingsService(stores, purchasePrices as never);
  return { model, findOneAndUpdate, service };
}

describe('validateProfitSettings — одна проверка для бота и CRM', () => {
  it('ставки 0–100, текст ошибки называет ставку и поле', () => {
    expect(validateProfitSettings({ commissionPercent: 0, taxPercent: 100 }).ok).toBe(true);

    const result = validateProfitSettings({ taxPercent: 101 });
    expect(result).toMatchObject({ ok: false, field: 'taxPercent' });
    if (result.ok === false) expect(result.error).toContain('Налог с продаж');
  });

  it('нечисло — ошибка, а не ноль', () => {
    expect(validateProfitSettings({ commissionPercent: Number.NaN })).toMatchObject({
      ok: false,
      field: 'commissionPercent',
    });
  });

  it('скидка бренда: неизвестный ключ и процент вне границ отбиваются с путём поля', () => {
    expect(validateProfitSettings({ brandDiscounts: { rolex: 5 } })).toMatchObject({
      ok: false,
      field: 'brandDiscounts.rolex',
    });
    const result = validateProfitSettings({ brandDiscounts: { casio: -1 } });
    expect(result).toMatchObject({ ok: false, field: 'brandDiscounts.casio' });
    if (result.ok === false) expect(result.error).toContain('CASIO');
  });
});

describe('validatePromoInput', () => {
  it('ноль и пустой порог = «порога нет»: ключа from нет вовсе', () => {
    expect(validatePromoInput('casio', { mode: 'flat', percent: 2, from: 0 })).toEqual({
      ok: true,
      value: { mode: 'flat', percent: 2 },
    });
    expect(validatePromoInput('casio', { mode: 'flat', percent: 2, from: null })).toEqual({
      ok: true,
      value: { mode: 'flat', percent: 2 },
    });
  });

  it('ступени с порогом сохраняются целиком', () => {
    const result = validatePromoInput('casio', {
      mode: 'tiered',
      limit: 10000,
      below: 2,
      above: 1,
      from: 3000,
    });
    expect(result).toEqual({
      ok: true,
      value: { mode: 'tiered', limit: 10000, below: 2, above: 1, from: 3000 },
    });
    // Сохранённое переживает чтение отчётом — не мусор для promoConfigsOf.
    if (result.ok === true) expect(promoConfigsOf({ casio: result.value }).casio).toBeDefined();
  });

  it('отрицательный порог, граница ≤ 0 и процент > 100 — ошибки со своими полями', () => {
    expect(validatePromoInput('casio', { mode: 'flat', percent: 2, from: -1 })).toMatchObject({
      ok: false,
      field: 'from',
    });
    expect(
      validatePromoInput('casio', { mode: 'tiered', limit: 0, below: 2, above: 1 }),
    ).toMatchObject({ ok: false, field: 'limit' });

    const above = validatePromoInput('casio', { mode: 'tiered', limit: 1, below: 2, above: 101 });
    expect(above).toMatchObject({ ok: false, field: 'above' });
    if (above.ok === false) expect(above.error).toContain('процент свыше порога');
  });

  it('неизвестный режим — ошибка поля mode', () => {
    expect(validatePromoInput('casio', { mode: 'x' } as never)).toMatchObject({
      ok: false,
      field: 'mode',
    });
  });
});

describe('StoreSettingsService', () => {
  it('форма целиком — ОДНА запись; прочие бренды не стираются', async () => {
    const { model, findOneAndUpdate, service } = setup([
      { telegramUserId: USER, brandDiscounts: { seiko: 7 } } as never,
    ]);

    const result = await service.setProfitSettings(USER, {
      commissionPercent: 25,
      discountPercent: 12,
      brandDiscounts: { casio: 5 },
    });

    expect(result.ok).toBe(true);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);

    const store = model.documents[0];
    expect(ratesOf(store).commissionPercent).toBe(25);
    expect(discountsOf(store)).toMatchObject({
      defaultPercent: 12,
      brandPercents: { casio: 5, seiko: 7 },
    });
  });

  it('ошибка проверки — в базу ничего не пишется', async () => {
    const { findOneAndUpdate, service } = setup();
    const result = await service.setProfitSettings(USER, {
      commissionPercent: 25,
      taxPercent: 200,
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid', field: 'taxPercent' });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('магазина нет — no-store', async () => {
    const { service } = setup([]);
    expect(await service.setRate(USER, 'taxPercent', 6)).toEqual({
      ok: false,
      reason: 'no-store',
    });
  });

  it('промо: запись и отключение ($unset, не ноль)', async () => {
    const { model, service } = setup();

    await service.setPromotion(USER, 'casio', { mode: 'flat', percent: 2, from: 0 });
    expect(model.documents[0].promoCommissions).toEqual({ casio: { mode: 'flat', percent: 2 } });

    await service.setPromotion(USER, 'casio', null);
    expect(model.documents[0].promoCommissions).toEqual({});
  });

  it('промо: неизвестный бренд — invalid, без записи', async () => {
    const { findOneAndUpdate, service } = setup();
    expect(await service.setPromotion(USER, 'rolex', null)).toMatchObject({
      ok: false,
      field: 'brand',
    });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('снимок: только бренды из прайса, действующие проценты, легаси «Востока»', async () => {
    const { service } = setup();
    const settings = await service.settingsOf(USER);

    expect(settings).toMatchObject({ commissionPercent: 23, discountPercent: 10, otherCount: 1 });
    expect(settings?.brands.map((brand) => [brand.key, brand.discountPercent])).toEqual([
      ['vostok', 4],
      ['casio', 10],
    ]);
  });

  it('storeSettingsOf: мусорная запись промо показывается как «не настроено»', () => {
    const settings = storeSettingsOf({ promoCommissions: { casio: { mode: 'flat', from: 0 } } }, [
      { name: 'CASIO' },
    ]);
    expect(settings.brands[0].promo).toBeNull();
  });
});
