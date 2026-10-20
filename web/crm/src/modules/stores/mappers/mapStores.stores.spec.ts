import { describe, expect, it } from 'vitest';

import { mapStoreItem } from './mapStores.stores';

describe('mapStores', () => {
  it('пустой кабинет — null, прочерк рисует таблица', () => {
    expect(
      mapStoreItem({ key: 'k', label: 'x.ru · FBS', businessName: '', placementType: 'FBS' })
        .businessName,
    ).toBeNull();
  });
});
