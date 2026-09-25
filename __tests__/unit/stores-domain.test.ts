import type { YandexMarketDocument } from '../../src/database/schemas/yandex-market.schema';

import { describe, expect, it } from 'vitest';

import {
  botStoreAfterToken,
  findByKey,
  scopeStore,
  storeKeyOf,
} from '../../src/modules/yandex/stores/stores.domain';
import { placementOfCampaign } from '../../src/modules/yandex/stocks/placement';

const FBS = {
  campaignId: '148655119',
  businessId: '164225008',
  businessName: 'SBrand',
  storeName: 'Время с SBrand',
  placementType: 'FBS',
};
const FBY = { ...FBS, campaignId: '148704883', placementType: 'FBY' };
const OTHER = { ...FBS, campaignId: '555', businessId: '777', storeName: 'other.ru' };

function docOf(overrides: Record<string, unknown> = {}): YandexMarketDocument {
  return {
    telegramUserId: '222',
    token: 'ACMA:x',
    campaign_id: FBS.campaignId,
    business_id: FBS.businessId,
    name: FBS.storeName,
    commissionPercent: 25,
    stores: [FBS, FBY, OTHER],
    ...overrides,
  } as unknown as YandexMarketDocument;
}

describe('storeKeyOf', () => {
  it('стабилен, 16 hex и не содержит campaign_id', () => {
    const key = storeKeyOf(FBS.campaignId);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(storeKeyOf(FBS.campaignId)).toBe(key);
    expect(key).not.toContain(FBS.campaignId);
    expect(storeKeyOf(FBY.campaignId)).not.toBe(key);
  });

  it('findByKey находит запись кэша по ключу, чужой ключ — нет', () => {
    expect(findByKey([FBS, FBY], storeKeyOf(FBY.campaignId))).toBe(FBY);
    expect(findByKey([FBS], storeKeyOf(FBY.campaignId))).toBeUndefined();
    expect(findByKey(undefined, 'x')).toBeUndefined();
  });
});

describe('scopeStore', () => {
  it('перекрывает кампанию, бизнес и имя; ставки и токен — прежние', () => {
    const scoped = scopeStore(docOf(), OTHER.campaignId);
    expect(scoped).toMatchObject({
      campaign_id: '555',
      business_id: '777',
      name: 'other.ru',
      token: 'ACMA:x',
      commissionPercent: 25,
    });
  });

  it('модель читается по перекрытой кампании — тем же placementOfCampaign', () => {
    const scoped = scopeStore(docOf(), FBY.campaignId);
    expect(placementOfCampaign(scoped?.stores, scoped?.campaign_id)).toBe('FBY');
  });

  it('кампании нет в кэше токена → null (это и есть проверка доступа)', () => {
    expect(scopeStore(docOf(), '999')).toBeNull();
    expect(scopeStore(docOf({ stores: [] }), FBS.campaignId)).toBeNull();
  });

  it('исходный документ не меняется', () => {
    const doc = docOf();
    scopeStore(doc, FBY.campaignId);
    expect(doc.campaign_id).toBe(FBS.campaignId);
  });

  it('у mongoose-документа берёт toObject(), а не геттеры', () => {
    const plain = docOf();
    const mongooseLike = { toObject: () => plain, stores: plain.stores };
    const scoped = scopeStore(mongooseLike as never, FBY.campaignId);
    expect(scoped).toMatchObject({ campaign_id: FBY.campaignId, token: 'ACMA:x' });
    expect((scoped as unknown as { toObject?: unknown }).toObject).toBeUndefined();
  });
});

describe('botStoreAfterToken', () => {
  it('прежний магазин открывается новым токеном — активный в боте не меняется', () => {
    expect(botStoreAfterToken([OTHER, FBS], FBS.campaignId)).toEqual({
      store: FBS,
      changed: false,
    });
  });

  it('не открывается — первый из нового списка, с пометкой', () => {
    expect(botStoreAfterToken([OTHER, FBY], FBS.campaignId)).toEqual({
      store: OTHER,
      changed: true,
    });
  });

  it('пустой список — null', () => {
    expect(botStoreAfterToken([], FBS.campaignId)).toBeNull();
  });
});
