import { describe, expect, it } from 'vitest';

import { openTiles, quickLinks } from './useDashboardTiles.dashboard';

describe('видимость на главной', () => {
  it('плитка — только при открытой фиче; закрыли report_profit — прибыли нет', () => {
    const all = {
      report_in_transit: true,
      report_returning: true,
      report_shipped_today: true,
      report_profit: true,
    };
    expect(openTiles(all).map((t) => t.key)).toEqual([
      'in_transit',
      'returning',
      'shipped_today',
      'profit',
    ]);
    expect(openTiles({ ...all, report_profit: false }).map((t) => t.key)).not.toContain('profit');
    expect(openTiles(undefined)).toEqual([]);
  });

  it('ссылки — открытые разделы без самой главной', () => {
    expect(quickLinks(['ym-dashboard', 'ym-orders', 'profile']).map((i) => i.name)).toEqual([
      'ym-orders',
    ]);
    expect(quickLinks(null)).toEqual([]);
  });
});
