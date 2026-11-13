import { describe, expect, it } from 'vitest';

import {
  ACCOUNTING_DASHBOARD_FEATURE,
  ACCOUNTING_FEATURE,
  ACCOUNTING_ORDERS_FEATURE,
  ACCOUNTING_RECONCILE_FEATURE,
  ACCOUNTING_RETURNS_FEATURE,
} from '../accounting.domain';

import { openAccountingTabs } from './useAccountingTabs.accounting';

const keys = (features: Record<string, boolean> | undefined) =>
  openAccountingTabs(features).map((tab) => tab.key);

describe('openAccountingTabs', () => {
  it('без зонтика — ни одной вкладки, даже при открытых подфичах', () => {
    expect(keys(undefined)).toEqual([]);
    expect(keys({ [ACCOUNTING_DASHBOARD_FEATURE]: true })).toEqual([]);
  });

  it('один зонтик — себестоимость, операции и загрузка данных', () => {
    expect(keys({ [ACCOUNTING_FEATURE]: true })).toEqual(['costs', 'operations', 'sync']);
  });

  it('подфичи открывают свои вкладки, панель — первой', () => {
    expect(
      keys({
        [ACCOUNTING_FEATURE]: true,
        [ACCOUNTING_DASHBOARD_FEATURE]: true,
        [ACCOUNTING_ORDERS_FEATURE]: true,
        [ACCOUNTING_RETURNS_FEATURE]: true,
        [ACCOUNTING_RECONCILE_FEATURE]: true,
      }),
    ).toEqual(['dashboard', 'orders', 'returns', 'reconcile', 'costs', 'operations', 'sync']);
  });
});
