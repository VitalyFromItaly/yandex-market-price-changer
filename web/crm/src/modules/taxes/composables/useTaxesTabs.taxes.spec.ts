import { describe, expect, it } from 'vitest';

import { openTaxesTabs } from './useTaxesTabs.taxes';

describe('вкладки «Налогов»', () => {
  it('«Год» — только при фиче tax_year; «Настройки» — всегда', () => {
    expect(openTaxesTabs({ taxes: true }).map((t) => t.key)).toEqual(['settings']);
    expect(openTaxesTabs(undefined).map((t) => t.key)).toEqual(['settings']);
    expect(openTaxesTabs({ taxes: true, tax_year: true }).map((t) => t.key)).toEqual([
      'settings',
      'year',
    ]);
  });
});
