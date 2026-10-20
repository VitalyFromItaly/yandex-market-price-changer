import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_NAV,
  ALL_MARKETPLACES,
  MARKETPLACE_NAV,
  MARKETPLACES,
  marketplaceOfPath,
  STORE_NAV,
  sidebarGroups,
  UPCOMING_MARKETPLACES,
  visibleNav,
} from './navigation';

describe('visibleNav', () => {
  it('показывает только разделы, названные сервером, в порядке меню', () => {
    const items = visibleNav(MARKETPLACE_NAV, ['ym-settings', 'ym-stores']);
    expect(items.map((item) => item.name)).toEqual(['ym-stores', 'ym-settings']);
  });

  it('закрытая «Прибыль» пропадает из меню магазина', () => {
    const open = STORE_NAV.map((item) => item.name).filter((name) => name !== 'ym-profit');
    expect(visibleNav(STORE_NAV, open).some((item) => item.name === 'ym-profit')).toBe(false);
  });

  it('профиль ещё не загружен — меню пустое, а не всё подряд', () => {
    expect(visibleNav(ACCOUNT_NAV, null)).toEqual([]);
  });

  it('разделы магазина — относительные пути под /ym/stores/:store, аккаунта — абсолютные', () => {
    expect(STORE_NAV.every((item) => !item.path.startsWith('/'))).toBe(true);
    expect([...MARKETPLACE_NAV, ...ACCOUNT_NAV].every((item) => item.path.startsWith('/'))).toBe(
      true,
    );
  });
});

describe('sidebarGroups', () => {
  const store = { key: 'abcd', label: 'Время', sections: ['ym-dashboard', 'ym-orders'] };

  it('разделы открытого магазина остаются на страницах аккаунта и ведут в него', () => {
    const first = sidebarGroups(['ym-stores', 'ym-settings', 'profile'], store)[0];
    expect(first?.title).toBe('Время');
    expect(first?.items.map((item) => item.name)).toEqual(['ym-dashboard', 'ym-orders']);
    expect(first?.params).toEqual({ store: 'abcd' });
  });

  it('магазин ещё не открывали — только разделы аккаунта, без ключа в ссылках', () => {
    const groups = sidebarGroups(['ym-stores', 'profile'], null);
    expect(groups.map((group) => group.key)).toEqual(['marketplace', 'account']);
    expect(groups.every((group) => Object.keys(group.params).length === 0)).toBe(true);
  });
});

describe('площадки', () => {
  it('все три по порядку, разделы пока только у ЯМ', () => {
    expect(ALL_MARKETPLACES.map((m) => m.key)).toEqual(['ym', 'ozon', 'wb']);
    expect(MARKETPLACES.map((m) => m.key)).toEqual(['ym']);
    expect(UPCOMING_MARKETPLACES.map((m) => m.key)).toEqual(['ozon', 'wb']);
  });

  it('площадка по адресу — первый сегмент; вне площадки — null', () => {
    expect(marketplaceOfPath('/ym/stores/abcd/orders')).toBe('ym');
    expect(marketplaceOfPath('/ozon')).toBe('ozon');
    expect(marketplaceOfPath('/wb/anything')).toBe('wb');
    expect(marketplaceOfPath('/profile')).toBeNull();
    expect(marketplaceOfPath('/')).toBeNull();
  });

  it('выбор ЯМ ведёт в список магазинов — в его же раздел меню', () => {
    const ym = ALL_MARKETPLACES.find((m) => m.key === 'ym');
    expect(ym?.home).toBe(MARKETPLACE_NAV.find((item) => item.name === 'ym-stores')?.path);
  });
});
