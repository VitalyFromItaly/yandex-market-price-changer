import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_NAV,
  ALL_MARKETPLACES,
  isLiveMarketplace,
  liveMarketplaces,
  MARKETPLACE_NAV,
  marketplaceHome,
  marketplaceOfPath,
  navFor,
  STORE_NAV,
  sidebarGroups,
  upcomingMarketplaces,
  visibleNav,
} from './navigation';
import { sectionName, sectionPath } from './navigation.sections';

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
    const first = sidebarGroups('ym', ['ym-stores', 'ym-settings', 'profile'], store)[0];
    expect(first?.title).toBe('Время');
    expect(first?.items.map((item) => item.name)).toEqual(['ym-dashboard', 'ym-orders']);
    expect(first?.params).toEqual({ store: 'abcd' });
  });

  it('магазин ещё не открывали — только разделы аккаунта, без ключа в ссылках', () => {
    const groups = sidebarGroups(null, ['ym-stores', 'profile'], null);
    expect(groups.map((group) => group.key)).toEqual(['marketplace', 'account']);
    expect(groups.every((group) => Object.keys(group.params).length === 0)).toBe(true);
  });

  it('без площадок — только группа аккаунта, пустой группы площадки нет (TASK-193)', () => {
    const groups = sidebarGroups(null, ['connections', 'profile', 'help'], null);
    expect(groups.map((group) => group.key)).toEqual(['account']);
    expect(groups[0]?.items.map((item) => item.name)).toEqual(['connections', 'profile', 'help']);
  });
});

describe('площадки', () => {
  it('все три по порядку; статический адрес Ozon/WB — первый готовый раздел', () => {
    expect(ALL_MARKETPLACES.map((m) => m.key)).toEqual(['ym', 'ozon', 'wb']);
    expect(ALL_MARKETPLACES.map((m) => m.home)).toEqual([
      '/ym/stores',
      '/ozon/overview',
      '/wb/overview',
    ]);
  });

  it('живая площадка — от сервера: ЯМ всегда, Ozon/WB — при готовом разделе в me.sections', () => {
    const keys = (list: { key: string }[]): string[] => list.map((m) => m.key);
    // Профиль не загрузился — живой только ЯМ.
    expect(keys(liveMarketplaces(null))).toEqual(['ym']);
    expect(keys(upcomingMarketplaces(null))).toEqual(['ozon', 'wb']);
    // Без фичи ozon сервер не отдаёт ozon-* — Ozon «скоро».
    expect(keys(liveMarketplaces(['ym-stores', 'ym-finance']))).toEqual(['ym']);
    // С фичей ozon — живая; WB по-прежнему «скоро».
    const withOzon = ['ym-stores', 'ozon-finance'];
    expect(keys(liveMarketplaces(withOzon))).toEqual(['ym', 'ozon']);
    expect(keys(upcomingMarketplaces(withOzon))).toEqual(['wb']);
    // Раздел, которого нет среди готовых, площадку не открывает.
    expect(isLiveMarketplace('wb', ['wb-nonexistent'])).toBe(false);
  });

  it('адрес площадки: у живой — первый открытый раздел, иначе статический', () => {
    expect(marketplaceHome('ym', null)).toBe('/ym/stores');
    expect(marketplaceHome('ozon', null)).toBe('/ozon/overview');
    expect(marketplaceHome('ozon', ['ozon-overview', 'ozon-finance'])).toBe('/ozon/overview');
    // «Обзор» закрыт своей фичей — ведём в первый открытый раздел.
    expect(marketplaceHome('ozon', ['ozon-finance'])).toBe('/ozon/finance');
  });

  it('на площадке «скоро» сайдбар показывает разделы ЯМ, на живой — её свои', () => {
    const soon = sidebarGroups('ozon', ['ym-finance'], null);
    expect(soon[0]?.items.map((item) => item.name)).toEqual(['ym-finance']);
    const live = sidebarGroups('ozon', ['ym-finance', 'ozon-finance'], null);
    expect(live[0]?.items.map((item) => item.name)).toEqual(['ozon-finance']);
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

describe('разделы по площадке', () => {
  // Прежние адреса и имена ЯМ — продавцы держат на них закладки, сервер отдаёт эти имена.
  const YM_NAV: [string, string][] = [
    ['ym-overview', '/ym/overview'],
    ['ym-stores', '/ym/stores'],
    ['ym-schedule', '/ym/schedule'],
    ['ym-settings', '/ym/settings'],
    ['ym-expenses', '/ym/expenses'],
    ['ym-taxes', '/ym/taxes'],
    ['ym-purchases', '/ym/purchases'],
    ['ym-finance', '/ym/finance'],
    ['ym-unit-economics', '/ym/unit-economics'],
    ['ym-sales-analytics', '/ym/sales-analytics'],
    ['ym-marketplaces-dashboard', '/ym/marketplaces-dashboard'],
    ['ym-marketplace-compare', '/ym/marketplace-compare'],
    ['ym-sku-ratings', '/ym/sku-ratings'],
    ['ym-inventory', '/ym/inventory'],
    ['ym-order-feed', '/ym/order-feed'],
    ['ym-returns-analytics', '/ym/returns-analytics'],
    ['ym-forecast', '/ym/forecast'],
    ['ym-products', '/ym/products'],
    ['ym-price-calculator', '/ym/price-calculator'],
    ['ym-price-set', '/ym/price-set'],
    ['ym-ai-analyst', '/ym/ai-analyst'],
    ['ym-notifications', '/ym/notifications'],
  ];

  it('ЯМ — прежние имена и адреса в прежнем порядке', () => {
    expect(navFor('ym').map((item) => [item.name, item.path])).toEqual(YM_NAV);
    expect(MARKETPLACE_NAV).toEqual(navFor('ym'));
  });

  it('разделы магазина — прежние имена и сегменты', () => {
    expect(STORE_NAV.map((item) => [item.name, item.path])).toEqual([
      ['ym-dashboard', ''],
      ['ym-orders', 'orders'],
      ['ym-profit', 'profit'],
      ['ym-price-list', 'price-list'],
      ['ym-quarantine', 'quarantine'],
      ['ym-feedback', 'feedback'],
      ['ym-payments', 'payments'],
      ['ym-market-reports', 'market-reports'],
      ['ym-recommendations', 'recommendations'],
      ['ym-offer-cards', 'offer-cards'],
      ['ym-fby', 'fby'],
      ['ym-warehouses', 'warehouses'],
    ]);
  });

  it('свой раздел площадки — под её префиксом, общий и только-ЯМ — под /ym', () => {
    expect([sectionName('ozon', 'finance'), sectionPath('ozon', 'finance')]).toEqual([
      'ozon-finance',
      '/ozon/finance',
    ]);
    expect([sectionName('wb', 'taxes'), sectionPath('wb', 'taxes')]).toEqual([
      'ym-taxes',
      '/ym/taxes',
    ]);
    expect(sectionPath('ozon', 'settings')).toBe('/ym/settings');
  });

  it('Ozon: в меню свои разделы журнала и общие экраны ЯМ, без разделов только ЯМ', () => {
    const names = navFor('ozon').map((item) => item.name);
    expect(names).toEqual([
      'ozon-overview',
      'ym-expenses',
      'ym-taxes',
      'ym-purchases',
      'ozon-finance',
      'ozon-unit-economics',
      'ozon-sales-analytics',
      'ym-marketplaces-dashboard',
      'ym-marketplace-compare',
      'ozon-sku-ratings',
      'ozon-inventory',
      'ozon-order-feed',
      'ozon-returns-analytics',
      'ozon-forecast',
      'ym-products',
      'ym-price-set',
      'ym-ai-analyst',
      'ym-notifications',
    ]);
  });

  it('Ozon в адресе — сайдбар показывает её разделы, а не разделы ЯМ', () => {
    const marketplace = sidebarGroups('ozon', ['ym-stores', 'ym-taxes', 'ozon-finance'], null)[0];
    expect(marketplace?.items.map((item) => item.name)).toEqual(['ym-taxes', 'ozon-finance']);
  });
});
