import { describe, expect, it } from 'vitest';

import { filtersFromQuery, filtersQuery } from './useOrderFeedFilters.order-feed';

describe('фильтры «Ленты заказов» в адресе', () => {
  it('query → фильтры; мусор — «все»; площадка — из адреса раздела, `?mp` не читается', () => {
    expect(filtersFromQuery({ mp: 'ozon', stage: 'in_transit', q: 'casio' })).toEqual({
      stage: 'in_transit',
      product: 'casio',
    });
    expect(filtersFromQuery({ stage: 'lost' })).toEqual({ stage: null, product: '' });
  });

  it('фильтры → query: пустое не пишется', () => {
    expect(filtersQuery({ stage: 'redeemed', product: '  ' })).toEqual({
      stage: 'redeemed',
    });
  });
});
