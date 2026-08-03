import { describe, it, expect } from 'vitest';

import { storeLabel } from '../../src/modules/telegram/bots/price-changer-bot/store-picker';
import {
  storeTitle,
  withPlacement,
} from '../../src/modules/telegram/bots/price-changer-bot/store-title';

/**
 * Как магазин называется продавцу.
 *
 * Не косметика. На боевом аккаунте у одного продавца ДВЕ кампании с одинаковым
 * названием «Время с SBrand» — 148655119 (FBS) и 148704883 (FBY). Без модели
 * сообщение «Магазин переключён: Время с SBrand» не отвечает, куда переключились,
 * а разница принципиальная: на FBY остатки записать нельзя.
 */
const FBS_TWIN = { campaignId: '148655119', placementType: 'FBS' };
const FBY_TWIN = { campaignId: '148704883', placementType: 'FBY' };
const STORES = [
  { campaignId: '124425371', placementType: 'FBS' },
  FBS_TWIN,
  FBY_TWIN,
];

describe('withPlacement', () => {
  it('склеивает имя и модель', () => {
    expect(withPlacement('Время с SBrand', 'FBY')).toBe('Время с SBrand · FBY');
  });

  it('без модели — голое имя, без хвоста-разделителя', () => {
    // Догадка здесь хуже умолчания: приписать FBS магазину с незаполненным
    // кэшем значит пообещать запись остатков там, где её может не быть.
    expect(withPlacement('Время с SBrand')).toBe('Время с SBrand');
    expect(withPlacement('Время с SBrand', '')).toBe('Время с SBrand');
    expect(withPlacement('Время с SBrand', '   ')).toBe('Время с SBrand');
  });
});

describe('storeTitle', () => {
  const doc = (campaignId: string) => ({
    name: 'Время с SBrand',
    campaign_id: campaignId,
    stores: STORES,
  });

  it('различает одноимённые магазины по campaign_id', () => {
    // Ровно тот случай, ради которого модель и печатается.
    expect(storeTitle(doc('148655119'))).toBe('Время с SBrand · FBS');
    expect(storeTitle(doc('148704883'))).toBe('Время с SBrand · FBY');
    expect(storeTitle(doc('148655119'))).not.toBe(storeTitle(doc('148704883')));
  });

  it('кэш пуст или кампании в нём нет — только имя', () => {
    expect(storeTitle({ name: 'Магазин', campaign_id: '1' })).toBe('Магазин');
    expect(storeTitle({ name: 'Магазин', campaign_id: 'нет такой', stores: STORES })).toBe(
      'Магазин',
    );
  });

  it('без имени отдаёт fallback, а не пустую строку с моделью', () => {
    expect(storeTitle(null)).toBe('');
    expect(storeTitle(undefined, '✅ подключён')).toBe('✅ подключён');
    expect(storeTitle({ name: '   ', campaign_id: '148704883', stores: STORES }, '—')).toBe('—');
  });
});

describe('Пикер и экраны называют магазин ОДИНАКОВО', () => {
  it('storeLabel и storeTitle дают одну строку для одного магазина', () => {
    // Это и есть защита от расхождения: кнопка пикера подписана «… · FBY», а
    // следующее за ней подтверждение обязано сказать то же самое. Две копии
    // склейки разъехались бы молча — беда, ради которой в проекте появились
    // menu.constants.ts и access-decision.text.ts.
    const fromPicker = storeLabel({
      campaignId: FBY_TWIN.campaignId,
      businessId: '164225008',
      businessName: 'Время от SBrand',
      storeName: 'Время с SBrand',
      placementType: 'FBY',
    });

    const fromScreen = storeTitle({
      name: 'Время с SBrand',
      campaign_id: FBY_TWIN.campaignId,
      stores: STORES,
    });

    expect(fromPicker).toBe(fromScreen);
  });

  it('магазин без модели тоже совпадает', () => {
    const fromPicker = storeLabel({
      campaignId: '1',
      businessId: 'b',
      businessName: 'Кабинет',
      storeName: 'Магазин',
    });

    expect(fromPicker).toBe(storeTitle({ name: 'Магазин', campaign_id: '1' }));
  });
});
