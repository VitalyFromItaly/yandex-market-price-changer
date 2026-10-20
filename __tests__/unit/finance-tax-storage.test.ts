import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import {
  FinanceTaxService,
  TaxSettingsValidationError,
} from '../../src/modules/finance/finance-tax.service';
import { createTestFinanceDb } from '../helpers/test-postgres';

const SELLER = '222';
const OTHER = '333';

describe('Налоговые настройки в Postgres', () => {
  let test: ITestFinanceDb;
  let service: FinanceTaxService;

  beforeAll(async () => {
    test = await createTestFinanceDb();
    service = new FinanceTaxService(new FinanceTaxSettingsRepository(test.db));
  }, 60_000);

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    await test.reset();
  });

  it('без записи — умолчание ALL BEST WATCH, в базу ничего не пишется', async () => {
    const snapshot = await service.snapshot(SELLER);
    expect(snapshot).toEqual({
      settings: { regime: 'usn_income', rateBasisPoints: 600, recognition: 'payment' },
      isDefault: true,
      updatedAt: null,
      hasStaff: false,
    });
    expect(await new FinanceTaxSettingsRepository(test.db).find(SELLER)).toBeNull();
  });

  it('upsert: вторая запись обновляет ту же строку, чужой продавец не задет', async () => {
    await service.update(SELLER, { rate: '4,5' });
    const second = await service.update(SELLER, { recognition: 'realization' });
    expect(second.settings).toEqual({
      regime: 'usn_income',
      rateBasisPoints: 450,
      recognition: 'realization',
    });
    expect(second.isDefault).toBe(false);
    expect(second.updatedAt).toBeInstanceOf(Date);
    expect((await service.snapshot(OTHER)).isDefault).toBe(true);
  });

  it('смена режима без ставки — ставка нового режима; со ставкой — введённая', async () => {
    const changed = await service.update(SELLER, { regime: 'usn_income_minus_expenses' });
    expect(changed.settings.rateBasisPoints).toBe(1500);
    const own = await service.update(SELLER, { regime: 'usn_income', rate: 1 });
    expect(own.settings).toMatchObject({ regime: 'usn_income', rateBasisPoints: 100 });
  });

  it('ошибка проверки — TaxSettingsValidationError с полем, запись не меняется', async () => {
    await service.update(SELLER, { rate: '5' });
    await expect(service.update(SELLER, { rate: '6,5' })).rejects.toMatchObject({
      field: 'rate',
    });
    await expect(service.update(SELLER, { regime: 'npd' })).rejects.toBeInstanceOf(
      TaxSettingsValidationError,
    );
    expect((await service.snapshot(SELLER)).settings.rateBasisPoints).toBe(500);
  });
});
