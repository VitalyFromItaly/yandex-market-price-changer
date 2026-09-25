import { describe, expect, it } from 'vitest';

import { openProfitReports } from './useProfitTabs.profit';

import { resolveTab } from '@/shared/composables';

describe('вкладки «Прибыли»', () => {
  it('только открытые, «Прибыль» первой', () => {
    const open = openProfitReports({ tariff_calc: true, report_profit: true });
    expect(open.map((meta) => meta.key)).toEqual(['profit', 'tariff_calc']);
    expect(openProfitReports({ report_profit: true, tariff_calc: false })).toHaveLength(1);
    expect(openProfitReports(undefined)).toEqual([]);
  });

  it('раздел открыт одним калькулятором — он же вкладка по умолчанию', () => {
    const open = openProfitReports({ report_profit: false, tariff_calc: true });
    expect(resolveTab(undefined, open)?.key).toBe('tariff_calc');
    expect(resolveTab('profit', open)?.key).toBe('tariff_calc');
  });
});
