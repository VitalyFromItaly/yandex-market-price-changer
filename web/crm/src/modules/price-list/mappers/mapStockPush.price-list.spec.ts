import type { StockPushPlan, StockPushTarget } from '../price-list.domain';

import { describe, expect, it } from 'vitest';

import {
  applyLines,
  confirmText,
  coverageText,
  deltaText,
  mapApplyError,
  marketplaceOptions,
  optionNote,
  targetStatus,
} from './mapStockPush.price-list';

import { ApiError } from '@/shared/http';

function target(over: Partial<StockPushTarget> = {}): StockPushTarget {
  return {
    marketplace: 'ym',
    marketplaceLabel: 'Яндекс Маркет',
    key: 'c1',
    name: 'Магазин',
    placement: 'FBS',
    blockedBy: null,
    blockedText: null,
    error: null,
    updates: [],
    zeroed: 0,
    unchanged: 3,
    notListed: 0,
    notWritable: 0,
    willWrite: false,
    ...over,
  };
}

const ROW = { internalSku: 'A', name: null, sku: 'A', from: 5, to: 3, priceListStock: 5, sold: 2 };

describe('маппер «Передачи остатков»', () => {
  it('статус площадки — по блокировке и числу строк', () => {
    expect(targetStatus(target()).label).toBe('Совпадает');
    expect(targetStatus(target({ updates: [ROW], willWrite: true })).label).toBe('Запишем 1');
    // Запись площадки закрыта фичей — строки есть, но это просмотр.
    expect(targetStatus(target({ updates: [ROW] })).label).toBe('Только просмотр');
    expect(targetStatus(target({ blockedBy: 'several-warehouses' })).label).toBe('Не пишется');
    expect(targetStatus(target({ blockedBy: 'zeroing' })).variant).toBe('danger');
    expect(targetStatus(target({ blockedBy: 'no-write-method' })).label).toBe('Только просмотр');
  });

  it('разница со знаком', () => {
    expect(deltaText(5, 3)).toBe('-2');
    expect(deltaText(3, 5)).toBe('+2');
  });

  it('итог записи строкой на магазин, пустой — объяснение', () => {
    expect(
      applyLines({
        writes: [
          {
            marketplace: 'ym',
            key: 'c1',
            name: 'М',
            requested: 3,
            written: 3,
            errors: [],
            skipped: [],
          },
        ],
      }),
    ).toEqual(['«М»: записано 3 из 3.']);
    expect(
      applyLines({
        writes: [
          {
            marketplace: 'wb',
            key: 'wb:9',
            name: 'WB · Дом',
            requested: 2,
            written: 1,
            errors: [],
            skipped: [{ sku: 'B', reason: 'несколько размеров' }],
          },
        ],
      }),
    ).toEqual(['«WB · Дом»: записано 1 из 2; не отправлено: 1 (несколько размеров).']);
    expect(
      applyLines({
        writes: [
          {
            marketplace: 'ym',
            key: 'c1',
            name: 'М',
            requested: 3,
            written: 0,
            errors: [],
            skipped: [],
            skipReason: 'write-disabled',
          },
        ],
      })[0],
    ).toMatch(/выключена на сервере/);
    expect(applyLines({ writes: [] })[0]).toMatch(/нечего/);
  });

  it('409 PUSH_RUNNING отдаёт jobId идущей записи', () => {
    const error = new ApiError('идёт', 409, 'PUSH_RUNNING', null, { jobId: 'j1' });
    expect(mapApplyError(error)).toEqual({ message: 'идёт', runningJobId: 'j1' });
    expect(mapApplyError(new Error('x')).runningJobId).toBeNull();
  });

  it('площадки плана: цели ЯМ сводятся в одну строку, писать можно только willWrite', () => {
    const plan = {
      targets: [
        target({ key: 'c1', updates: [ROW], willWrite: true }),
        target({ key: 'c2', name: 'Второй', updates: [ROW, ROW], willWrite: true }),
        target({ marketplace: 'ozon', marketplaceLabel: 'Ozon', key: 'ozon', updates: [ROW] }),
        target({
          marketplace: 'wb',
          marketplaceLabel: 'Wildberries',
          key: 'wb',
          blockedBy: 'several-warehouses',
        }),
      ],
    } as StockPushPlan;
    const options = marketplaceOptions(plan);
    expect(options).toHaveLength(3);
    const [ym, ozon, wb] = options as [
      (typeof options)[number],
      (typeof options)[number],
      (typeof options)[number],
    ];
    expect(ym).toMatchObject({ marketplace: 'ym', writable: true, count: 3 });
    expect(ym.targets).toHaveLength(2);
    expect(ozon).toMatchObject({ writable: false, count: 0 });
    expect(optionNote(ozon)).toMatch(/только просмотр/);
    expect(optionNote(wb)).toMatch(/не пишется/);
    expect(optionNote(ym)).toBe('запишем 3 поз.');
    expect(confirmText([ym])).toMatch(
      /^Будет записано 3 позиций: Яндекс Маркет «Магазин», Яндекс Маркет «Второй»/,
    );
  });

  it('закуп по площадкам — только открытые, без закупа и без площадок молчим', () => {
    const coverage = { products: 10, ozon: 7, wb: 10 };
    expect(coverageText(coverage, ['ozon', 'wb'])).toMatch(
      /Ozon — 7 из 10, Wildberries — 10 из 10/,
    );
    expect(coverageText(coverage, ['ozon'])).toMatch(/Непривязанные/);
    expect(coverageText(coverage, ['wb'])).not.toMatch(/Непривязанные/);
    expect(coverageText(coverage, [])).toBeNull();
    expect(coverageText(null, ['ozon'])).toBeNull();
    expect(coverageText({ products: 0, ozon: 0, wb: 0 }, ['ozon'])).toBeNull();
  });
});
