import { describe, expect, it } from 'vitest';

import { openReports, resolveReport } from './useOrdersTabs.orders';

describe('вкладки отчётов', () => {
  it('только открытые фичи, в порядке раздела', () => {
    const open = openReports({
      report_returning: true,
      report_shipped_today: true,
      report_redeemed: false,
    });
    expect(open.map((meta) => meta.key)).toEqual(['shipped_today', 'returning']);
    expect(openReports(undefined)).toEqual([]);
  });

  it('вкладка из URL, если открыта; иначе первая открытая', () => {
    const open = openReports({ report_redeemed: true, report_in_transit: true });
    expect(resolveReport('in_transit', open)?.key).toBe('in_transit');
    expect(resolveReport('shipped_today', open)?.key).toBe('redeemed');
    expect(resolveReport(undefined, open)?.key).toBe('redeemed');
    expect(resolveReport('redeemed', [])).toBeNull();
  });
});
