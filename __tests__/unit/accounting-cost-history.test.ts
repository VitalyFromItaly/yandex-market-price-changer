import type { IAccountingCostRecord } from '../../src/modules/accounting/accounting-cost-history.domain';
import type { IDiscountConfig } from '../../src/modules/yandex/reports/profit';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AccountingCostHistoryRepository } from '../../src/database/postgres/repositories/accounting-cost-history.repository';
import {
  UNKNOWN_COST_LABEL,
  accountingCostAt,
  accountingUnitCost,
  correctionKind,
  costHistoryCarryOver,
  moscowDayStartOf,
  priceListCostWrites,
  validateCostCorrection,
} from '../../src/modules/accounting/accounting-cost-history.domain';
import {
  AccountingCostHistoryService,
  CostCorrectionValidationError,
  CostHistoryProductNotFoundError,
} from '../../src/modules/accounting/accounting-cost-history.service';
import { createTestFinanceDb, type ITestFinanceDb } from '../helpers/test-postgres';

/**
 * История закупа v2 «Финучёта» (TASK-213): момент вместо дня, строгая
 * «Неизвестная закупка», исправление прошлой цены с журналом.
 */

const at = (iso: string) => new Date(iso);
const rec = (
  iso: string,
  price: number,
  source: IAccountingCostRecord['source'] = 'price-list',
): IAccountingCostRecord => ({ validFrom: at(iso), purchase: { price, currency: 'RUR' }, source });
const NO_DISCOUNTS: IDiscountConfig = { defaultPercent: 0, brandPercents: {} };

describe('accountingCostAt — строгая закупка на момент', () => {
  it('до первой записи — неизвестно, без отката на текущий закуп', () => {
    const records = [rec('2026-11-01T10:00:00+03:00', 1500)];
    expect(accountingCostAt(records, at('2026-10-31T23:59:59+03:00'))).toEqual({
      status: 'unknown',
    });
    expect(accountingCostAt([], at('2026-11-05T12:00:00+03:00'))).toEqual({ status: 'unknown' });
    expect(accountingCostAt(records, null)).toEqual({ status: 'unknown' });
    expect(accountingCostAt(records, at('мусор'))).toEqual({ status: 'unknown' });
    expect(UNKNOWN_COST_LABEL).toBe('Неизвестная закупка');
  });

  it('граница — включительно, точность до времени: две записи за день', () => {
    const records = [
      rec('2026-11-01T10:00:00+03:00', 1500),
      rec('2026-11-01T15:30:00+03:00', 1600),
    ];
    expect(accountingCostAt(records, at('2026-11-01T10:00:00+03:00'))).toMatchObject({
      status: 'known',
      purchase: { price: 1500 },
    });
    expect(accountingCostAt(records, at('2026-11-01T15:29:59+03:00'))).toMatchObject({
      purchase: { price: 1500 },
    });
    expect(accountingCostAt(records, at('2026-11-01T15:30:00+03:00'))).toMatchObject({
      purchase: { price: 1600 },
    });
  });

  it('приёмка №2: 1 500 ₽ 1.11, продажа 5.11, 1 800 ₽ 10.11 — у продажи 1 500 ₽ до и после', () => {
    const sale = at('2026-11-05T14:00:00+03:00');
    const before = [rec('2026-11-01T09:00:00+03:00', 1500)];
    const after = [...before, rec('2026-11-10T09:00:00+03:00', 1800)];
    const costBefore = accountingUnitCost({}, before, NO_DISCOUNTS, sale);
    const costAfter = accountingUnitCost({}, after, NO_DISCOUNTS, sale);
    expect(costBefore).toMatchObject({ status: 'known', kopecks: 150_000 });
    expect(costAfter).toEqual(costBefore);
    // Продажа после 10.11 — уже новая цена.
    expect(
      accountingUnitCost({}, after, NO_DISCOUNTS, at('2026-11-11T00:00:00+03:00')),
    ).toMatchObject({
      kopecks: 180_000,
    });
  });

  it('валюта без курса — неизвестно, не цена из файла', () => {
    const records: IAccountingCostRecord[] = [
      {
        validFrom: at('2026-11-01T00:00:00Z'),
        purchase: { price: 10, currency: 'USD' },
        source: 'manual',
      },
    ];
    expect(accountingUnitCost({}, records, NO_DISCOUNTS, at('2026-11-02T00:00:00Z'))).toEqual({
      status: 'unknown',
      reason: 'unconvertible',
    });
    expect(accountingUnitCost({}, [], NO_DISCOUNTS, at('2026-11-02T00:00:00Z'))).toEqual({
      status: 'unknown',
      reason: 'no-record',
    });
  });
});

describe('priceListCostWrites — только изменения', () => {
  const now = at('2026-11-08T12:00:00+03:00');
  const productIds = new Map([
    ['A', 'p1'],
    ['B', 'p2'],
  ]);

  it('нет записи — пишется; тот же закуп — ничего; новый — пишется с моментом загрузки', () => {
    const records = new Map([['p2', [rec('2026-11-01T00:00:00+03:00', 200)]]]);
    const writes = priceListCostWrites(
      [
        { sku: 'A', price: 100 },
        { sku: 'B', price: 200 },
        { sku: 'C', price: 50 },
      ],
      { productIds, records, previous: new Map() },
      now,
    );
    expect(writes).toEqual([
      {
        productId: 'p1',
        validFrom: now,
        purchase: { price: 100, currency: 'RUR' },
        source: 'price-list',
      },
    ]);

    const changed = priceListCostWrites(
      [{ sku: 'B', price: 210 }],
      { productIds, records, previous: new Map() },
      now,
    );
    expect(changed).toMatchObject([{ productId: 'p2', purchase: { price: 210 } }]);
  });

  it('доп. расходы переносятся; ручная запись не переписывается тем же файлом', () => {
    const manual: IAccountingCostRecord = {
      validFrom: at('2026-11-02T00:00:00+03:00'),
      purchase: { price: 10, currency: 'USD', rate: 95, extraCosts: 30 },
      source: 'manual',
    };
    const records = new Map([['p1', [manual]]]);
    const same = priceListCostWrites(
      [{ sku: 'A', price: 900 }],
      { productIds, records, previous: new Map([['A', { price: 900 }]]) },
      now,
    );
    expect(same).toEqual([]);
    const fresh = priceListCostWrites(
      [{ sku: 'A', price: 1000 }],
      { productIds, records, previous: new Map([['A', { price: 900 }]]) },
      now,
    );
    expect(fresh).toMatchObject([{ purchase: { price: 1000, currency: 'RUR', extraCosts: 30 } }]);
  });
});

describe('исправление и перенос', () => {
  const now = at('2026-11-08T12:00:00+03:00');
  const form = {
    validFrom: '2026-11-01T09:00:00+03:00',
    price: '1 600',
    reason: 'Счёт поставщика №12',
  };

  it('проверка формы', () => {
    expect(validateCostCorrection(form, now)).toMatchObject({
      ok: true,
      purchase: { price: 1600, currency: 'RUR' },
      reason: 'Счёт поставщика №12',
    });
    expect(validateCostCorrection({ ...form, validFrom: '' }, now)).toMatchObject({
      field: 'validFrom',
    });
    expect(
      validateCostCorrection({ ...form, validFrom: '2026-12-01T00:00:00Z' }, now),
    ).toMatchObject({
      field: 'validFrom',
    });
    expect(validateCostCorrection({ ...form, price: 0 }, now)).toMatchObject({ field: 'price' });
    expect(validateCostCorrection({ ...form, currency: 'USD' }, now)).toMatchObject({
      field: 'rate',
    });
    expect(validateCostCorrection({ ...form, reason: '  ' }, now)).toMatchObject({
      field: 'reason',
    });
  });

  it('correct / insert / noop', () => {
    const existing = rec('2026-11-01T09:00:00+03:00', 1500);
    expect(correctionKind(null, { price: 1600 })).toBe('insert');
    expect(correctionKind(existing, { price: 1600, currency: 'RUR' })).toBe('correct');
    expect(correctionKind(existing, { price: 1500 })).toBe('noop');
  });

  it('перенос из CostHistory: стартовая отброшена, день → 00:00 МСК', () => {
    expect(moscowDayStartOf('2026-11-01')?.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(moscowDayStartOf('2026-02-30')).toBeNull();
    const writes = costHistoryCarryOver('p1', [
      { validFrom: null, price: 900 },
      { validFrom: '2026-11-01', price: 1500, currency: 'RUR', extraCosts: 20 },
    ]);
    expect(writes).toEqual([
      {
        productId: 'p1',
        validFrom: at('2026-10-31T21:00:00.000Z'),
        purchase: { price: 1500, currency: 'RUR', extraCosts: 20 },
        source: 'cost-history',
      },
    ]);
  });
});

describe('хранение v2 (Postgres)', () => {
  const SELLER = '100';
  const OTHER = '200';
  let pg: ITestFinanceDb;
  let repo: AccountingCostHistoryRepository;
  let service: AccountingCostHistoryService;
  const owned = new Set([`${SELLER}:p1`]);
  const products = {
    resolveForPriceList: async (_uid: string, skus: string[]) =>
      new Map(skus.filter((sku) => sku === 'A').map((sku) => [sku, 'p1'])),
    findOwned: async (uid: string, id: string) => (owned.has(`${uid}:${id}`) ? { _id: id } : null),
  };
  const actor = { author: SELLER, impersonatedBy: null };

  beforeAll(async () => {
    pg = await createTestFinanceDb();
    repo = new AccountingCostHistoryRepository(pg.db);
    service = new AccountingCostHistoryService(repo, products as never);
  });
  afterAll(async () => {
    await pg.close();
  });
  afterEach(async () => {
    await pg.reset();
  });

  it('прайс → продажа → новый прайс: себестоимость старой продажи не меняется; повтор прайса — ноль записей', async () => {
    const rows = [{ sku: 'A', price: 1500 }];
    expect(
      await service.recordPriceList(SELLER, rows, new Map(), at('2026-11-01T09:00:00+03:00')),
    ).toBe(1);
    expect(
      await service.recordPriceList(SELLER, rows, new Map(), at('2026-11-01T18:00:00+03:00')),
    ).toBe(0);
    const sale = at('2026-11-05T14:00:00+03:00');
    const before = await service.costAt(SELLER, 'p1', sale);

    expect(
      await service.recordPriceList(
        SELLER,
        [{ sku: 'A', price: 1800 }],
        new Map(),
        at('2026-11-10T09:00:00+03:00'),
      ),
    ).toBe(1);
    expect(await service.costAt(SELLER, 'p1', sale)).toEqual(before);
    expect(before).toMatchObject({ status: 'known', purchase: { price: 1500 } });
    expect(await service.costAt(SELLER, 'p1', at('2026-10-31T00:00:00+03:00'))).toEqual({
      status: 'unknown',
    });
    // Чужой продавец записей не видит.
    expect(await service.costAt(OTHER, 'p1', sale)).toEqual({ status: 'unknown' });
  });

  it('две загрузки за день с разной ценой — две записи', async () => {
    await service.recordPriceList(
      SELLER,
      [{ sku: 'A', price: 100 }],
      new Map(),
      at('2026-11-01T09:00:00+03:00'),
    );
    await service.recordPriceList(
      SELLER,
      [{ sku: 'A', price: 110 }],
      new Map(),
      at('2026-11-01T15:00:00+03:00'),
    );
    const records = await repo.recordsFor(SELLER, ['p1']);
    expect(records.get('p1')?.map((row) => row.purchase.price)).toEqual([100, 110]);
  });

  it('исправление прошлой цены: журнал было/стало/автор/причина, ничего не удалено, себестоимость пересчиталась', async () => {
    const start = at('2026-11-01T09:00:00+03:00');
    await service.recordPriceList(SELLER, [{ sku: 'A', price: 1500 }], new Map(), start);
    const sale = at('2026-11-05T14:00:00+03:00');
    const now = at('2026-11-08T12:00:00+03:00');

    const corrected = await service.correct(
      SELLER,
      'p1',
      { validFrom: start.toISOString(), price: 1550, reason: 'Счёт поставщика' },
      actor,
      now,
    );
    expect(corrected.action).toBe('correct');
    expect(await service.costAt(SELLER, 'p1', sale)).toMatchObject({ purchase: { price: 1550 } });

    // Новая цена задним числом между записями.
    const inserted = await service.correct(
      SELLER,
      'p1',
      { validFrom: '2026-11-04T00:00:00+03:00', price: '1 700', reason: 'Доплата поставщику' },
      { author: SELLER, impersonatedBy: '999' },
      now,
    );
    expect(inserted.action).toBe('insert');
    expect(await service.costAt(SELLER, 'p1', sale)).toMatchObject({ purchase: { price: 1700 } });

    // Повтор той же формы — без новой строки журнала.
    const again = await service.correct(
      SELLER,
      'p1',
      { validFrom: '2026-11-04T00:00:00+03:00', price: 1700, reason: 'Доплата поставщику' },
      actor,
      now,
    );
    expect(again.action).toBe('noop');

    const view = await service.history(SELLER, 'p1');
    expect(view.records).toHaveLength(2);
    expect(view.records[0]).toMatchObject({
      source: 'manual',
      author: SELLER,
      purchase: { price: 1550 },
    });
    expect(view.changes).toHaveLength(2);
    expect(view.changes[1]).toMatchObject({
      action: 'correct',
      before: { validFrom: start.toISOString(), purchase: { price: 1500 } },
      after: { validFrom: start.toISOString(), purchase: { price: 1550 } },
      author: SELLER,
      reason: 'Счёт поставщика',
    });
    expect(view.changes[0]).toMatchObject({
      action: 'insert',
      before: null,
      impersonatedBy: '999',
    });
  });

  it('ошибки: кривая форма и чужой товар', async () => {
    await expect(
      service.correct(SELLER, 'p1', { validFrom: '2026-11-01T00:00:00Z', price: 10 }, actor),
    ).rejects.toBeInstanceOf(CostCorrectionValidationError);
    await expect(service.history(OTHER, 'p1')).rejects.toBeInstanceOf(
      CostHistoryProductNotFoundError,
    );
    await expect(
      service.correct(
        OTHER,
        'p1',
        { validFrom: '2026-11-01T00:00:00Z', price: 10, reason: 'x' },
        actor,
      ),
    ).rejects.toBeInstanceOf(CostHistoryProductNotFoundError);
  });

  it('перенос: повтор безопасен, исправление не затирается', async () => {
    const writes = costHistoryCarryOver('p1', [{ validFrom: '2026-11-01', price: 1500 }]);
    expect(await repo.insertMany(SELLER, writes)).toBe(1);
    expect(await repo.insertMany(SELLER, writes)).toBe(0);
  });
});
