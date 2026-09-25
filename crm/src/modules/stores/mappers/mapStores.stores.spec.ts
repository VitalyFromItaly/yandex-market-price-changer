import { describe, expect, it } from 'vitest';

import { mapStoreItem, mapTokenReplaced, tokenReplacedText } from './mapStores.stores';

describe('mapStores', () => {
  it('пустой кабинет — null, прочерк рисует таблица', () => {
    expect(
      mapStoreItem({ key: 'k', label: 'x.ru · FBS', businessName: '', placementType: 'FBS' })
        .businessName,
    ).toBeNull();
  });

  it('тост после смены токена говорит, только если в боте сменился магазин', () => {
    const same = mapTokenReplaced({ stores: [], botStore: null });
    expect(tokenReplacedText(same)).toBe('Список магазинов обновлён.');

    const moved = mapTokenReplaced({ stores: [], botStore: 'other.ru · FBS' });
    expect(tokenReplacedText(moved)).toContain('в боте активным стал «other.ru · FBS»');
  });
});
