import { describe, expect, it } from 'vitest';

import { FINANCE_ANOMALIES_FEATURE, FINANCE_UPLOAD_FEATURE } from '../constants/tabs.finance';

import { openFinanceTabs } from './useFinanceTabs.finance';

describe('openFinanceTabs', () => {
  it('«Аномалии» — только при своей фиче, остальные — всегда', () => {
    expect(openFinanceTabs({}).map((tab) => tab.key)).toEqual(['pnl', 'cashflow', 'audit']);
    expect(openFinanceTabs(undefined).map((tab) => tab.key)).toEqual(['pnl', 'cashflow', 'audit']);
    expect(openFinanceTabs({ [FINANCE_ANOMALIES_FEATURE]: true }).map((tab) => tab.key)).toEqual([
      'pnl',
      'cashflow',
      'audit',
      'anomalies',
    ]);
  });

  it('«Загрузка» — только у ЯМ: файл — отчёт Маркета по платежам (TASK-180)', () => {
    const features = { [FINANCE_UPLOAD_FEATURE]: true, [FINANCE_ANOMALIES_FEATURE]: true };
    for (const mp of ['ozon', 'wb'] as const) {
      expect(openFinanceTabs(features, mp).map((tab) => tab.key)).toEqual([
        'pnl',
        'cashflow',
        'audit',
        'anomalies',
      ]);
    }
  });

  it('«Загрузка» — только при своей фиче', () => {
    expect(openFinanceTabs({ [FINANCE_UPLOAD_FEATURE]: true }).map((tab) => tab.key)).toEqual([
      'pnl',
      'cashflow',
      'audit',
      'upload',
    ]);
  });
});
