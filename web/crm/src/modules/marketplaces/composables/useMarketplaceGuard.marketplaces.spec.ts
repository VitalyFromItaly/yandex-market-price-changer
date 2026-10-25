import { describe, expect, it } from 'vitest';

import { MARKETPLACE_UPCOMING_ROUTE_NAME } from '../pages/routes';

import { resolveMarketplaceRoute } from './useMarketplaceGuard.marketplaces';

const ozonOverview = { name: 'ozon-overview', path: '/ozon/overview' };
const ozonSoon = { name: MARKETPLACE_UPCOMING_ROUTE_NAME, path: '/ozon/something' };
const withOzon = ['ym-stores', 'ozon-overview', 'ozon-finance'];

describe('resolveMarketplaceRoute', () => {
  it('ЯМ и страницы вне площадки — без проверки', () => {
    expect(resolveMarketplaceRoute(null, { name: 'ym-finance', path: '/ym/finance' })).toBe(true);
    expect(resolveMarketplaceRoute(null, { name: 'profile', path: '/profile' })).toBe(true);
  });

  it('без фичи ozon раздел Ozon открывает «скоро» по имени маршрута, адрес прежний', () => {
    expect(resolveMarketplaceRoute(['ym-stores'], ozonOverview)).toEqual({
      name: MARKETPLACE_UPCOMING_ROUTE_NAME,
      params: { mp: 'ozon', rest: ['overview'] },
    });
    // Сама «скоро» — пускает, петли нет.
    expect(resolveMarketplaceRoute(['ym-stores'], ozonSoon)).toBe(true);
  });

  it('профиль не загрузился — Ozon «скоро»', () => {
    expect(resolveMarketplaceRoute(null, ozonOverview)).toMatchObject({
      name: MARKETPLACE_UPCOMING_ROUTE_NAME,
    });
  });

  it('с фичей ozon — раздел открыт, «скоро» ведёт в первый открытый раздел', () => {
    expect(resolveMarketplaceRoute(withOzon, ozonOverview)).toBe(true);
    expect(resolveMarketplaceRoute(withOzon, ozonSoon)).toBe('/ozon/overview');
  });

  it('живая площадка, раздел закрыт своей фичей — в её первый открытый раздел', () => {
    const forecast = { name: 'ozon-forecast', path: '/ozon/forecast' };
    expect(resolveMarketplaceRoute(['ozon-finance'], forecast)).toBe('/ozon/finance');
  });
});
