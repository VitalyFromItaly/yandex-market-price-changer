import { describe, expect, it } from 'vitest';

import { filtersFromQuery, filtersQuery } from './useOrderFeedFilters.order-feed';

describe('фильтры «Ленты заказов» в адресе', () => {
  it('query → фильтры; мусор — «все»', () => {
    expect(filtersFromQuery({ mp: 'ozon', stage: 'in_transit', q: 'casio' })).toEqual({
      marketplace: 'ozon',
      stage: 'in_transit',
      product: 'casio',
    });
    expect(filtersFromQuery({ mp: 'aliexpress', stage: 'lost' })).toEqual({
      marketplace: null,
      stage: null,
      product: '',
    });
  });

  it('фильтры → query: пустое не пишется', () => {
    expect(filtersQuery({ marketplace: null, stage: 'redeemed', product: '  ' })).toEqual({
      stage: 'redeemed',
    });
  });
});
