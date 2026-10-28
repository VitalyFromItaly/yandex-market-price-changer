import { describe, it, expect, vi } from 'vitest';

import type {
  IStockPushInput,
  IStockPushOrder,
  IStockPushProduct,
  IStockPushTargetInput,
} from '../../src/modules/finance/stock-push';

import {
  toCrmStockPush,
  parseMarketplaces,
  parsePlanHash,
} from '../../src/modules/crm/stock-push/crm-stock-push.domain';
import { STOCK_PUSH_MAX_ZEROED, stockPushPlanOf } from '../../src/modules/finance/stock-push';
import {
  STOCK_PUSH_SCHEDULE_LOG_KIND,
  STOCK_PUSH_WRITE_FEATURE,
  StockPushPlanChangedError,
  StockPushService,
} from '../../src/modules/stock-push/stock-push.service';
import { OzonApiError } from '../../src/modules/ozon/ozon.errors';
import { FEATURE, FEATURE_META } from '../../src/modules/telegram/bots/shared/features.domain';
import { StockSyncProcessor } from '../../src/modules/telegram/queue/processors/stock-sync.processor';
import { REQUIRE_FEATURE } from '../../src/modules/crm/crm-auth.decorators';
import { CRM_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import { CrmStockPushController } from '../../src/modules/crm/stock-push/crm-stock-push.controller';
import { CrmStockPushKinds } from '../../src/modules/crm/stock-push/crm-stock-push.kinds';
import { StockSyncService } from '../../src/modules/yandex/stocks/stock-sync.service';

/**
 * «Передача остатков» (TASK-143): сквозной FBS-остаток = прайс − продажи со
 * своего склада всех площадок после загрузки (решение
 * `stock_push_formula_price_minus_sales`), и всё неизвестное — запрет.
 */

const TODAY = '2026-10-18';
const PRICE_DAY = '2026-10-15';

function product(over: Partial<IStockPushProduct> = {}): IStockPushProduct {
  return {
    id: 'p1',
    internalSku: 'A-1',
    name: 'Часы A',
    stock: 10,
    stockDay: PRICE_DAY,
    skus: { ym: 'A-1', ozon: 'OZ-A' },
    ...over,
  };
}

function order(over: Partial<IStockPushOrder> = {}): IStockPushOrder {
  return {
    scheme: 'FBS',
    stage: 'awaiting_assembly',
    createdDay: '2026-10-16',
    items: [{ sku: 'A-1', count: 1 }],
    ...over,
  };
}

function ymTarget(over: Partial<IStockPushTargetInput> = {}): IStockPushTargetInput {
  return {
    marketplace: 'ym',
    key: 'c1',
    name: 'Магазин',
    placement: 'FBS',
    available: { 'A-1': 10 },
    canWrite: true,
    ...over,
  };
}

function input(over: Partial<IStockPushInput> = {}): IStockPushInput {
  return {
    products: [product()],
    orders: [{ marketplace: 'ym', source: 'Магазин', orders: [] }],
    targets: [ymTarget()],
    today: TODAY,
    oldestStockDay: '2026-09-20',
    ...over,
  };
}

describe('stockPushPlanOf — формула', () => {
  it('прайс минус продажи всех площадок со своего склада', () => {
    const plan = stockPushPlanOf(
      input({
        orders: [
          {
            marketplace: 'ym',
            source: 'Магазин',
            orders: [order({ items: [{ sku: 'A-1', count: 2 }] })],
          },
          {
            marketplace: 'ozon',
            source: 'Ozon',
            orders: [order({ items: [{ sku: 'OZ-A', count: 3 }] })],
          },
        ],
      }),
    );
    expect(plan.targets[0].updates).toEqual([
      expect.objectContaining({ sku: 'A-1', from: 10, to: 5, priceListStock: 10, sold: 5 }),
    ]);
    expect(plan.targets[0].blockedBy).toBeNull();
  });

  it('FBY/FBO/FBW, отменённые и заказы до прайса не вычитаются; день загрузки — вычитается', () => {
    const plan = stockPushPlanOf(
      input({
        orders: [
          {
            marketplace: 'ym',
            source: 'Магазин',
            orders: [
              order({ scheme: 'FBY' }),
              order({ scheme: 'FBO' }),
              order({ scheme: null }),
              order({ stage: 'cancelled' }),
              order({ createdDay: '2026-10-14' }),
              order({ createdDay: PRICE_DAY }),
            ],
          },
        ],
      }),
    );
    expect(plan.targets[0].updates[0]).toMatchObject({ sold: 1, to: 9 });
  });

  it('не выше физического и не ниже нуля', () => {
    const plan = stockPushPlanOf(
      input({
        products: [product({ stock: 2 })],
        orders: [
          {
            marketplace: 'ym',
            source: 'М',
            orders: [order({ items: [{ sku: 'A-1', count: 7 }] })],
          },
        ],
        targets: [ymTarget({ available: { 'A-1': 50 } })],
      }),
    );
    const row = plan.targets[0].updates[0];
    expect(row.to).toBe(0);
    expect(row.to).toBeLessThanOrEqual(2);
  });

  it('товар вне последнего прайса, старше окна или без количества — вне плана', () => {
    const plan = stockPushPlanOf(
      input({
        products: [
          product(),
          product({ id: 'p2', internalSku: 'B', skus: { ym: 'B' }, stockDay: '2026-10-01' }),
          product({ id: 'p3', internalSku: 'C', skus: { ym: 'C' }, stock: null }),
        ],
        targets: [ymTarget({ available: { 'A-1': 10, B: 5, C: 5 } })],
      }),
    );
    expect(plan.skipped.map((s) => [s.internalSku, s.reason])).toEqual([
      ['B', 'not-in-last-price-list'],
      ['C', 'no-stock'],
    ]);

    const old = stockPushPlanOf(
      input({ products: [product({ stockDay: '2026-09-01' })], oldestStockDay: '2026-09-20' }),
    );
    expect(old.skipped[0].reason).toBe('price-list-too-old');
    expect(old.targets[0].updates).toEqual([]);
  });

  it('без изменения и без артикула в остатках площадки — не пишется', () => {
    const plan = stockPushPlanOf(
      input({
        products: [product(), product({ id: 'p2', internalSku: 'B', skus: { ym: 'B' } })],
        targets: [ymTarget({ available: { 'A-1': 10 } })],
      }),
    );
    expect(plan.targets[0]).toMatchObject({ updates: [], unchanged: 1, notListed: 1 });
  });
});

describe('stockPushPlanOf — барьеры', () => {
  it('сбой чтения заказов любой площадки — запись запрещена везде', () => {
    const plan = stockPushPlanOf(
      input({
        orders: [
          { marketplace: 'ym', source: 'Магазин', orders: [] },
          { marketplace: 'wb', source: 'WB', orders: null, error: 'timeout' },
        ],
        targets: [ymTarget({ available: { 'A-1': 3 } })],
      }),
    );
    expect(plan.ordersKnown).toBe(false);
    expect(plan.targets[0].blockedBy).toBe('orders-unknown');
    expect(plan.orderErrors).toEqual([{ marketplace: 'wb', source: 'WB', error: 'timeout' }]);
  });

  it('сбой чтения остатков площадки — запрещена только она', () => {
    const plan = stockPushPlanOf(
      input({
        targets: [
          ymTarget({ key: 'c1', available: null, error: 'boom' }),
          ymTarget({ key: 'c2', available: { 'A-1': 3 } }),
        ],
      }),
    );
    expect(plan.targets.map((t) => t.blockedBy)).toEqual(['read-error', null]);
  });

  it('FBY и неизвестная модель не пишутся никогда — раньше всех прочих причин', () => {
    for (const placement of ['FBY', null]) {
      const plan = stockPushPlanOf(input({ targets: [ymTarget({ placement, available: null })] }));
      expect(plan.targets[0].blockedBy).toBe('placement');
    }
  });

  it(`порог обнуления: ${STOCK_PUSH_MAX_ZEROED} — пишем, ${STOCK_PUSH_MAX_ZEROED + 1} — стоп`, () => {
    const build = (n: number) => {
      const products = Array.from({ length: n }, (_, i) =>
        product({ id: `p${i}`, internalSku: `S${i}`, stock: 0, skus: { ym: `S${i}` } }),
      );
      const available = Object.fromEntries(products.map((p) => [p.skus.ym, 4]));
      return stockPushPlanOf(input({ products, targets: [ymTarget({ available })] }));
    };
    expect(build(STOCK_PUSH_MAX_ZEROED).targets[0]).toMatchObject({ blockedBy: null, zeroed: 5 });
    expect(build(STOCK_PUSH_MAX_ZEROED + 1).targets[0]).toMatchObject({
      blockedBy: 'zeroing',
      zeroed: 6,
    });
  });

  it('площадка без метода записи — только просмотр', () => {
    const plan = stockPushPlanOf(
      input({
        targets: [
          {
            marketplace: 'ozon',
            key: 'ozon',
            name: 'Ozon',
            placement: 'FBS',
            available: { 'OZ-A': 1 },
            canWrite: false,
          },
        ],
      }),
    );
    expect(plan.targets[0].blockedBy).toBe('no-write-method');
    expect(plan.targets[0].updates[0]).toMatchObject({ sku: 'OZ-A', from: 1, to: 10 });
  });

  it('склад записи Ozon/WB не однозначен — площадка не пишется (TASK-175)', () => {
    const ozon = (warehouseBlock: IStockPushTargetInput['warehouseBlock']) =>
      stockPushPlanOf(
        input({
          targets: [
            {
              marketplace: 'ozon',
              key: 'ozon',
              name: 'Ozon',
              placement: 'FBS',
              available: { 'OZ-A': 1 },
              canWrite: true,
              warehouseBlock,
            },
          ],
        }),
      ).targets[0].blockedBy;
    expect(ozon('several-warehouses')).toBe('several-warehouses');
    expect(ozon('no-warehouse')).toBe('no-warehouse');
    expect(ozon(undefined)).toBeNull();
  });

  it('отпечаток — только записываемое, и меняется вместе с числом', () => {
    const empty = stockPushPlanOf(input()); // 10 → 10: писать нечего
    const nine = () => stockPushPlanOf(input({ targets: [ymTarget({ available: { 'A-1': 9 } })] }));
    const eight = stockPushPlanOf(input({ products: [product({ stock: 8 })] }));
    const blocked = stockPushPlanOf(
      input({ targets: [ymTarget({ available: { 'A-1': 9 }, canWrite: false })] }),
    );
    expect(nine().planHash).toBe(nine().planHash);
    expect(nine().planHash).not.toBe(empty.planHash);
    expect(eight.planHash).not.toBe(nine().planHash);
    expect(blocked.planHash).toBe(empty.planHash);
    expect(parsePlanHash(eight.planHash)).toBe(eight.planHash);
  });
});

describe('фича и раздел', () => {
  it('все фичи выключены по умолчанию, запись требует плана (и площадки)', () => {
    expect(FEATURE_META[FEATURE.STOCK_PUSH].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.STOCK_PUSH_WRITE_YM].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.STOCK_PUSH_WRITE_YM].requires).toEqual([FEATURE.STOCK_PUSH]);
    expect(FEATURE_META[FEATURE.STOCK_PUSH_WRITE_OZON]).toMatchObject({
      defaultEnabled: false,
      requires: [FEATURE.STOCK_PUSH, FEATURE.OZON],
    });
    expect(FEATURE_META[FEATURE.STOCK_PUSH_WRITE_WB]).toMatchObject({
      defaultEnabled: false,
      requires: [FEATURE.STOCK_PUSH, FEATURE.WB],
    });
    expect(STOCK_PUSH_WRITE_FEATURE).toEqual({
      ym: FEATURE.STOCK_PUSH_WRITE_YM,
      ozon: FEATURE.STOCK_PUSH_WRITE_OZON,
      wb: FEATURE.STOCK_PUSH_WRITE_WB,
    });
    // План живёт на «Прайсе» — своего раздела у него нет.
    expect(CRM_SECTIONS['ym-price-list']).toContain(FEATURE.STOCK_PUSH);
    expect(CRM_SECTIONS['ym-stock-push']).toBeUndefined();
  });

  it('гейт: маршрут записи — под планом и хоть одной фичей записи', async () => {
    expect(Reflect.getMetadata(REQUIRE_FEATURE, CrmStockPushController)).toEqual([
      FEATURE.STOCK_PUSH,
    ]);
    const claim = vi.fn();
    const controller = new CrmStockPushController({ add: vi.fn() } as never, { claim } as never);
    const request = (features: Record<string, boolean>) =>
      ({ crmUser: { telegramUserId: '1', features } }) as never;
    await expect(
      controller.apply(request({ [FEATURE.STOCK_PUSH]: true }), { planHash: 'a'.repeat(64) }),
    ).rejects.toMatchObject({ status: 403 });
    expect(claim).not.toHaveBeenCalled();

    // Площадки: пусто или чужое значение — 400, а не «писать всё».
    const writer = request({ [FEATURE.STOCK_PUSH]: true, [FEATURE.STOCK_PUSH_WRITE_YM]: true });
    for (const marketplaces of [[], ['ozon', 'avito'], 'ozon']) {
      await expect(
        controller.apply(writer, { planHash: 'a'.repeat(64), marketplaces }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(claim).not.toHaveBeenCalled();
    expect(parseMarketplaces(['ozon', 'ozon', 'wb'])).toEqual(['ozon', 'wb']);
    expect(parseMarketplaces(undefined)).toBeUndefined();

    const register = vi.fn();
    new CrmStockPushKinds({ register } as never, {} as never).onModuleInit();
    expect(register).toHaveBeenCalledWith(
      'stock-push:plan',
      expect.objectContaining({ features: [FEATURE.STOCK_PUSH], scope: 'account' }),
    );
  });

  it('вид CRM: кнопка пишет только ЯМ без блокировки', () => {
    const plan = stockPushPlanOf(
      input({
        products: [product({ stock: 7 })],
        targets: [
          ymTarget(),
          {
            marketplace: 'ozon',
            key: 'ozon',
            name: 'Ozon',
            placement: 'FBS',
            available: { 'OZ-A': 1 },
            canWrite: false,
          },
        ],
      }),
    );
    const view = toCrmStockPush(
      { plan, notConsidered: [] },
      { now: new Date(), writeOpen: { ym: true, ozon: false, wb: false } },
    );
    expect(view.targets.map((t) => t.willWrite)).toEqual([true, false]);
    expect(view.writeCount).toBe(1);
    expect(view.writeOpen).toBe(true);
  });

  it('вид CRM: Ozon пишется при открытой фиче, ЯМ при закрытой — нет', () => {
    const plan = stockPushPlanOf(
      input({
        products: [product({ stock: 7 })],
        targets: [
          ymTarget(),
          {
            marketplace: 'ozon',
            key: 'ozon:77',
            name: 'Ozon · Дом',
            placement: 'FBS',
            available: { 'OZ-A': 1 },
            canWrite: true,
          },
        ],
      }),
    );
    const view = toCrmStockPush(
      { plan, notConsidered: [] },
      { now: new Date(), writeOpen: { ym: false, ozon: true, wb: false } },
    );
    expect(view.targets.map((t) => t.willWrite)).toEqual([false, true]);
    const closed = toCrmStockPush(
      { plan, notConsidered: [] },
      { now: new Date(), writeOpen: { ym: false, ozon: false, wb: false } },
    );
    expect(closed.writeOpen).toBe(false);
    expect(closed.writeCount).toBe(0);
  });
});

/** Клиент Маркета для `writeStocks`: видно, дошло ли до склада и записи. */
function fakeClient(placementType = 'FBS') {
  return {
    listStores: vi.fn(async () => [{ campaignId: 'c1', businessId: 'b', placementType }]),
    getWarehouseId: vi.fn(async () => 777),
    updateStocks: vi.fn(async () => undefined),
  };
}

function writer(client: ReturnType<typeof fakeClient>, stockWriteEnabled = true) {
  return new StockSyncService(
    { forTenant: () => client } as never,
    {} as never,
    { stockWriteEnabled } as never,
    {} as never,
    { report: vi.fn() } as never,
    {} as never,
  );
}

const CREDS = { token: 't', campaignId: 'c1', businessId: 'b' };

describe('StockSyncService.writeStocks — барьеры внутри функции записи', () => {
  it('пишет на склад продавца FBS', async () => {
    const client = fakeClient();
    const result = await writer(client).writeStocks(CREDS, [{ sku: 'A', count: 3 }], {
      telegramUserId: '1',
    });
    expect(result.written).toBe(1);
    expect(client.updateStocks).toHaveBeenCalledWith([{ sku: 'A', count: 3 }], 777);
  });

  it('STOCK_WRITE_ENABLED=false — ни склада, ни записи, модель не спрашивается', async () => {
    const client = fakeClient();
    const result = await writer(client, false).writeStocks(CREDS, [{ sku: 'A', count: 3 }], {
      telegramUserId: '1',
    });
    expect(result).toMatchObject({ written: 0, skipReason: 'write-disabled' });
    expect(client.listStores).not.toHaveBeenCalled();
    expect(client.getWarehouseId).not.toHaveBeenCalled();
  });

  it('FBY и сбой чтения модели — не пишется', async () => {
    const fby = fakeClient('FBY');
    expect(
      (await writer(fby).writeStocks(CREDS, [{ sku: 'A', count: 3 }], { telegramUserId: '1' }))
        .skipReason,
    ).toBe('placement');
    expect(fby.getWarehouseId).not.toHaveBeenCalled();

    const broken = fakeClient();
    broken.listStores.mockRejectedValueOnce(new Error('ECONNRESET'));
    const result = await writer(broken).writeStocks(CREDS, [{ sku: 'A', count: 3 }], {
      telegramUserId: '1',
    });
    expect(result.skipReason).toBe('placement');
    expect(broken.updateStocks).not.toHaveBeenCalled();
  });

  it('отрицательный остаток отменяет запись целиком до склада', async () => {
    const client = fakeClient();
    await expect(
      writer(client).writeStocks(
        CREDS,
        [
          { sku: 'A', count: 1 },
          { sku: 'B', count: -1 },
        ],
        {
          telegramUserId: '1',
        },
      ),
    ).rejects.toThrow(/отменена целиком/);
    expect(client.getWarehouseId).not.toHaveBeenCalled();
  });
});

/** Сервис плана с площадками-заглушками. */
function pushService(
  opts: { ymOrdersFail?: boolean; ymStocksFail?: boolean; zeroing?: boolean } = {},
) {
  const writeStocks = vi.fn(async (_c: unknown, updates: unknown[]) => ({
    written: updates.length,
    errors: [],
  }));
  const report = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);
  const products = opts.zeroing
    ? Array.from({ length: 6 }, (_, i) => ({
        _id: `p${i}`,
        internalSku: `S${i}`,
        stock: 0,
        stockUpdatedAt: new Date('2026-10-15T09:00:00Z'),
        marketplaceSkus: { ym: `S${i}` },
      }))
    : [
        {
          _id: 'p1',
          internalSku: 'A-1',
          name: 'Часы',
          stock: 10,
          stockUpdatedAt: new Date('2026-10-15T09:00:00Z'),
          marketplaceSkus: { ym: 'A-1' },
        },
      ];
  const available = opts.zeroing
    ? Object.fromEntries(
        products.map((p) => [p.marketplaceSkus.ym, { available: 4, reserved: null }]),
      )
    : { 'A-1': { available: 10, reserved: null } };

  const registry = {
    capability: vi.fn(() => null),
    require: vi.fn((_mp: string, cap: string) =>
      cap === 'orders'
        ? {
            listOrders: vi.fn(async () => {
              if (opts.ymOrdersFail) throw new Error('timeout');
              return {
                orders: [
                  {
                    scheme: 'FBS',
                    stage: 'awaiting_assembly',
                    createdDay: '2026-10-16',
                    items: [{ sku: 'A-1', count: 2 }],
                  },
                ],
                cancelled: [],
              };
            }),
          }
        : {
            listStocks: vi.fn(async () => {
              if (opts.ymStocksFail) throw new Error('timeout');
              return { takenAt: new Date(), byLocation: { seller: available }, placement: 'FBS' };
            }),
          },
    ),
  };
  const doc = {
    telegramUserId: '1',
    token: 't',
    campaign_id: 'c1',
    business_id: 'b',
    name: 'Магазин',
    stores: [{ campaignId: 'c1', businessId: 'b', storeName: 'Магазин', placementType: 'FBS' }],
  };
  const service = new StockPushService(
    registry as never,
    { findWithPriceListStock: vi.fn(async () => products) } as never,
    { findByTelegramUser: vi.fn(async () => doc) } as never,
    { writeStocks } as never,
    { record } as never,
    { report } as never,
  );
  return { service, writeStocks, report, record, registry };
}

const NOW = new Date('2026-10-18T09:00:00Z');
const WRITE = { [FEATURE.STOCK_PUSH]: true, [FEATURE.STOCK_PUSH_WRITE_YM]: true };

describe('StockPushService', () => {
  it('план → запись тех же чисел, строка журнала на магазин', async () => {
    const { service, writeStocks, record } = pushService();
    const { plan } = await service.plan('1', WRITE, NOW);
    expect(plan.targets[0].updates[0]).toMatchObject({ from: 10, to: 8 });

    const result = await service.apply('1', WRITE, plan.planHash, NOW);
    expect(writeStocks).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'c1' }),
      [{ sku: 'A-1', count: 8 }],
      { telegramUserId: '1' },
    );
    expect(result.writes[0]).toMatchObject({ requested: 1, written: 1 });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'stock-push', direction: 'out', telegramUserId: '1' }),
    );
  });

  it('другой отпечаток — ничего не пишется', async () => {
    const { service, writeStocks } = pushService();
    await expect(service.apply('1', WRITE, '0'.repeat(64), NOW)).rejects.toBeInstanceOf(
      StockPushPlanChangedError,
    );
    expect(writeStocks).not.toHaveBeenCalled();
  });

  it('сбой чтения заказов — запись не выполняется (unknown = forbidden)', async () => {
    const { service, writeStocks } = pushService({ ymOrdersFail: true });
    const { plan } = await service.plan('1', WRITE, NOW);
    expect(plan.targets[0].blockedBy).toBe('orders-unknown');
    await service.apply('1', WRITE, plan.planHash, NOW);
    expect(writeStocks).not.toHaveBeenCalled();
  });

  it('массовое обнуление — не пишется и алерт', async () => {
    const { service, writeStocks, report } = pushService({ zeroing: true });
    const { plan } = await service.plan('1', WRITE, NOW);
    await service.apply('1', WRITE, plan.planHash, NOW);
    expect(writeStocks).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ context: 'stock-push:zeroing' }));
  });

  it('закрытая фича записи — отказ и в сервисе, не только в гварде', async () => {
    const { service, writeStocks } = pushService();
    const { plan } = await service.plan('1', WRITE, NOW);
    await expect(
      service.apply('1', { [FEATURE.STOCK_PUSH]: true }, plan.planHash, NOW),
    ).rejects.toThrow(/stock_push_write_/);
    expect(writeStocks).not.toHaveBeenCalled();
  });
});

/**
 * Сервис плана с одной площадкой Ozon или WB: заказы, остатки и запись — заглушки
 * реестра. `withYm` — ещё магазин ЯМ с тем же артикулом (выбор и сбой посреди записи).
 */
function ozonPushService(
  opts: {
    marketplace?: 'ozon' | 'wb';
    target?: unknown;
    targetFails?: unknown;
    noWriter?: boolean;
    ordersFail?: boolean;
    zeroing?: boolean;
    writeResult?: Record<string, unknown>;
    writeThrows?: boolean;
    withYm?: boolean;
  } = {},
) {
  const mp = opts.marketplace ?? 'ozon';
  const writeStocks = vi.fn(async (_ref: unknown, _wh: string, updates: unknown[]) => {
    if (opts.writeThrows) throw new Error('socket hang up');
    return { written: updates.length, errors: [], skipped: [], ...opts.writeResult };
  });
  const writeTarget = vi.fn(async () => {
    if (opts.targetFails) throw opts.targetFails === true ? new Error('timeout') : opts.targetFails;
    return opts.target ?? { kind: 'ok', warehouse: { id: '77', name: 'Дом' } };
  });
  const skus = opts.zeroing ? Array.from({ length: 6 }, (_, i) => `OZ-${i}`) : ['OZ-A'];
  const capabilities: Record<string, unknown> = {
    orders: {
      listOrders: vi.fn(async () => {
        if (opts.ordersFail) throw new Error('timeout');
        return {
          orders: [
            {
              scheme: 'FBS',
              stage: 'awaiting_assembly',
              createdDay: '2026-10-16',
              items: [{ sku: 'OZ-A', count: 2 }],
            },
          ],
          cancelled: [],
        };
      }),
    },
    stocks: {
      listStocks: vi.fn(async () => ({
        takenAt: new Date(),
        byLocation: {
          seller: Object.fromEntries(skus.map((sku) => [sku, { available: 10, reserved: 0 }])),
        },
        placement: null,
      })),
    },
    ...(opts.noWriter ? {} : { stockWrite: { writeTarget, writeStocks } }),
  };
  const registry = {
    capability: vi.fn((asked: string, cap: string) =>
      asked === mp ? (capabilities[cap] ?? null) : null,
    ),
    require: vi.fn((_mp: string, cap: string) => capabilities[cap]),
  };
  const products = skus.map((sku, i) => ({
    _id: `p${i}`,
    internalSku: `A-${i}`,
    name: 'Часы',
    stock: opts.zeroing ? 0 : 10,
    stockUpdatedAt: new Date('2026-10-15T09:00:00Z'),
    marketplaceSkus: { [mp]: sku, ...(opts.withYm ? { ym: sku } : {}) },
  }));
  const ymWrite = vi.fn(async (_c: unknown, updates: unknown[]) => ({
    written: updates.length,
    errors: [],
  }));
  const ymDoc = {
    telegramUserId: '1',
    token: 't',
    campaign_id: 'c1',
    business_id: 'b',
    name: 'Магазин',
    stores: [{ campaignId: 'c1', businessId: 'b', storeName: 'Магазин', placementType: 'FBS' }],
  };
  const report = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);
  const service = new StockPushService(
    registry as never,
    { findWithPriceListStock: vi.fn(async () => products) } as never,
    { findByTelegramUser: vi.fn(async () => (opts.withYm ? ymDoc : null)) } as never,
    { writeStocks: ymWrite } as never,
    { record } as never,
    { report } as never,
  );
  return { service, writeStocks, writeTarget, ymWrite, record, report };
}

const OZON_PLAN = { [FEATURE.STOCK_PUSH]: true, [FEATURE.OZON]: true };
const OZON_WRITE = { ...OZON_PLAN, [FEATURE.STOCK_PUSH_WRITE_OZON]: true };

describe('StockPushService — запись в Ozon (TASK-175)', () => {
  it('фича записи закрыта — тот же просмотр, что у ЯМ: цель по складу, но не пишется', async () => {
    const { service, writeTarget, writeStocks } = ozonPushService();
    const { plan } = await service.plan('1', OZON_PLAN, NOW);
    expect(plan.targets[0]).toMatchObject({ key: 'ozon:77', blockedBy: null });
    expect(writeTarget).toHaveBeenCalled();

    const ymOnly = { ...OZON_PLAN, [FEATURE.STOCK_PUSH_WRITE_YM]: true };
    const result = await service.apply('1', ymOnly, plan.planHash, NOW);
    expect(result.writes).toEqual([]);
    expect(writeStocks).not.toHaveBeenCalled();
  });

  it('фича открыта, но метода записи нет — только просмотр', async () => {
    const { service } = ozonPushService({ noWriter: true });
    const { plan } = await service.plan('1', OZON_WRITE, NOW);
    expect(plan.targets[0].blockedBy).toBe('no-write-method');
  });

  it('фича открыта и склад один — цель по складу, apply пишет те же числа', async () => {
    const { service, writeStocks, ymWrite, record } = ozonPushService();
    const { plan } = await service.plan('1', OZON_WRITE, NOW);
    expect(plan.targets[0]).toMatchObject({ key: 'ozon:77', name: 'Ozon · Дом', blockedBy: null });
    expect(plan.targets[0].updates[0]).toMatchObject({ sku: 'OZ-A', from: 10, to: 8 });

    const result = await service.apply('1', OZON_WRITE, plan.planHash, NOW);
    expect(writeStocks).toHaveBeenCalledWith({ telegramUserId: '1', marketplace: 'ozon' }, '77', [
      { sku: 'OZ-A', count: 8 },
    ]);
    expect(ymWrite).not.toHaveBeenCalled();
    expect(result.writes[0]).toMatchObject({ marketplace: 'ozon', requested: 1, written: 1 });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ marketplace: 'ozon' }) }),
    );
  });

  it('выбор площадок на «Прайсе»: не отмеченная площадка не пишется, отпечаток — по всему плану', async () => {
    const { service, writeStocks } = ozonPushService();
    const { plan } = await service.plan('1', OZON_WRITE, NOW);

    const skipped = await service.apply('1', OZON_WRITE, plan.planHash, NOW, ['ym']);
    expect(writeStocks).not.toHaveBeenCalled();
    expect(skipped.writes).toEqual([]);

    await service.apply('1', OZON_WRITE, plan.planHash, NOW, ['ozon']);
    expect(writeStocks).toHaveBeenCalledTimes(1);
  });

  it('несколько складов — блок, apply ничего не пишет', async () => {
    const { service, writeStocks } = ozonPushService({
      target: { kind: 'several', names: ['Дом', 'Второй'] },
    });
    const { plan } = await service.plan('1', OZON_WRITE, NOW);
    expect(plan.targets[0].blockedBy).toBe('several-warehouses');
    await service.apply('1', OZON_WRITE, plan.planHash, NOW);
    expect(writeStocks).not.toHaveBeenCalled();
  });

  it('склады не прочитались — read-error только у Ozon', async () => {
    const { service } = ozonPushService({ targetFails: true });
    const { plan } = await service.plan('1', OZON_WRITE, NOW);
    expect(plan.targets[0].blockedBy).toBe('read-error');
    expect(plan.targets[0].error).toMatch(/склады продавца не прочитались/);
  });

  it('сбой чтения — исходная ошибка админам (с запросом), продавцу — текст площадки', async () => {
    const failure = new OzonApiError('Request failed with status code 404', 404).withRequest(
      'post',
      '/v2/warehouse/list',
    );
    const { service, report } = ozonPushService({ targetFails: failure });
    const { plan } = await service.plan('1', OZON_WRITE, NOW);
    expect(plan.targets[0].error).toBe(`склады продавца не прочитались: ${failure.userMessage}`);
    expect(report).toHaveBeenCalledWith({
      error: failure,
      source: 'ozon',
      context: 'stock-push:read:ozon',
      action: 'склады',
      telegramUserId: '1',
    });
  });

  it('фича Ozon закрыта к моменту записи — Ozon не пишется', async () => {
    const { service, writeStocks } = ozonPushService();
    const { plan } = await service.plan('1', OZON_WRITE, NOW);
    const ymOnly = { ...OZON_PLAN, [FEATURE.STOCK_PUSH_WRITE_YM]: true };
    // План от фичи записи не зависит (как у ЯМ): отпечаток тот же, Ozon отсеивает запись.
    const result = await service.apply('1', ymOnly, plan.planHash, NOW);
    expect(result.writes).toEqual([]);
    expect(writeStocks).not.toHaveBeenCalled();
  });

  it('массовое обнуление — не пишется и алерт, как у ЯМ', async () => {
    const { service, writeStocks, report } = ozonPushService({ zeroing: true });
    const { plan } = await service.plan('1', OZON_WRITE, NOW);
    expect(plan.targets[0].blockedBy).toBe('zeroing');
    await service.apply('1', OZON_WRITE, plan.planHash, NOW);
    expect(writeStocks).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ozon', context: 'stock-push:zeroing' }),
    );
  });

  it('STOCK_WRITE_ENABLED=false — результат и журнал «пропущено», как у ЯМ', async () => {
    const { service, record } = ozonPushService({ writeResult: { skipReason: 'write-disabled' } });
    const { plan } = await service.plan('1', OZON_WRITE, NOW);
    const result = await service.apply('1', OZON_WRITE, plan.planHash, NOW);
    expect(result.writes[0]).toMatchObject({ written: 1, skipReason: 'write-disabled' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', error: 'запись пропущена: write-disabled' }),
    );
  });

  it('сбой чтения заказов — orders-unknown, ничего не пишется', async () => {
    const { service, writeStocks } = ozonPushService({ ordersFail: true });
    const { plan } = await service.plan('1', OZON_WRITE, NOW);
    expect(plan.targets[0].blockedBy).toBe('orders-unknown');
    await service.apply('1', OZON_WRITE, plan.planHash, NOW);
    expect(writeStocks).not.toHaveBeenCalled();
  });
});

const WB_PLAN = { [FEATURE.STOCK_PUSH]: true, [FEATURE.WB]: true };
const WB_WRITE = { ...WB_PLAN, [FEATURE.STOCK_PUSH_WRITE_WB]: true };

describe('StockPushService — WB тем же путём, что ЯМ и Ozon', () => {
  it('склад один — цель по складу, apply пишет те же числа, журнал по WB', async () => {
    const { service, writeStocks, record } = ozonPushService({ marketplace: 'wb' });
    const { plan } = await service.plan('1', WB_WRITE, NOW);
    expect(plan.targets[0]).toMatchObject({
      key: 'wb:77',
      name: 'Wildberries · Дом',
      blockedBy: null,
    });
    expect(plan.targets[0].updates[0]).toMatchObject({ sku: 'OZ-A', from: 10, to: 8 });

    const result = await service.apply('1', WB_WRITE, plan.planHash, NOW);
    expect(writeStocks).toHaveBeenCalledWith({ telegramUserId: '1', marketplace: 'wb' }, '77', [
      { sku: 'OZ-A', count: 8 },
    ]);
    expect(result.writes[0]).toMatchObject({ marketplace: 'wb', requested: 1, written: 1 });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ marketplace: 'wb' }) }),
    );
  });

  it('фича записи закрыта — просмотр, не пишется', async () => {
    const { service, writeStocks } = ozonPushService({ marketplace: 'wb' });
    const { plan } = await service.plan('1', WB_PLAN, NOW);
    expect(plan.targets[0]).toMatchObject({ key: 'wb:77', blockedBy: null });
    const ymOnly = { ...WB_PLAN, [FEATURE.STOCK_PUSH_WRITE_YM]: true };
    expect((await service.apply('1', ymOnly, plan.planHash, NOW)).writes).toEqual([]);
    expect(writeStocks).not.toHaveBeenCalled();
  });

  it('несколько складов — блок', async () => {
    const { service, writeStocks } = ozonPushService({
      marketplace: 'wb',
      target: { kind: 'several', names: ['Дом', 'Второй'] },
    });
    const { plan } = await service.plan('1', WB_WRITE, NOW);
    expect(plan.targets[0].blockedBy).toBe('several-warehouses');
    await service.apply('1', WB_WRITE, plan.planHash, NOW);
    expect(writeStocks).not.toHaveBeenCalled();
  });

  it('многоразмерная карточка видна в плане: не в «Запишем» и не в обнулении', async () => {
    const { service } = ozonPushService({
      marketplace: 'wb',
      zeroing: true,
      target: {
        kind: 'ok',
        warehouse: { id: '77', name: 'Дом' },
        unwritable: [{ sku: 'OZ-0', reason: 'несколько размеров' }],
      },
    });
    const { plan } = await service.plan('1', WB_WRITE, NOW);
    // Шесть обнулений минус одна многоразмерная — пять, порог не превышен.
    expect(plan.targets[0]).toMatchObject({ notWritable: 1, zeroed: 5, blockedBy: null });
    expect(plan.targets[0].updates.map((row) => row.sku)).not.toContain('OZ-0');
  });

  it('пропущенные WB позиции — в журнале записи', async () => {
    const { service, record } = ozonPushService({
      marketplace: 'wb',
      writeResult: {
        written: 0,
        skipped: [{ sku: 'OZ-A', reason: 'нет штрихкода в карточке WB' }],
      },
    });
    const { plan } = await service.plan('1', WB_WRITE, NOW);
    await service.apply('1', WB_WRITE, plan.planHash, NOW);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.stringMatching(/не отправлено 1$/) }),
    );
  });

  it('массовое обнуление и сбой заказов — как у ЯМ', async () => {
    const zero = ozonPushService({ marketplace: 'wb', zeroing: true });
    const zeroPlan = (await zero.service.plan('1', WB_WRITE, NOW)).plan;
    expect(zeroPlan.targets[0].blockedBy).toBe('zeroing');
    await zero.service.apply('1', WB_WRITE, zeroPlan.planHash, NOW);
    expect(zero.report).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'wb', context: 'stock-push:zeroing' }),
    );

    const orders = ozonPushService({ marketplace: 'wb', ordersFail: true });
    expect((await orders.service.plan('1', WB_WRITE, NOW)).plan.targets[0].blockedBy).toBe(
      'orders-unknown',
    );
  });

  it('сбой WB посреди записи — ЯМ, записанный раньше, остаётся в результате', async () => {
    const both = { ...WB_WRITE, [FEATURE.STOCK_PUSH_WRITE_YM]: true };
    const { service, ymWrite, report } = ozonPushService({
      marketplace: 'wb',
      withYm: true,
      writeThrows: true,
    });
    const { plan } = await service.plan('1', both, NOW);
    const result = await service.apply('1', both, plan.planHash, NOW);
    expect(ymWrite).toHaveBeenCalled();
    expect(result.writes.map((w) => [w.marketplace, w.written])).toEqual([
      ['ym', 1],
      ['wb', 0],
    ]);
    expect(result.writes[1].errors[0].message).toMatch(/socket hang up|Не удалось/);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'wb', context: 'stock-push:write' }),
    );
  });

  it('проход по расписанию пишет WB и пишет строку прохода', async () => {
    const { service, writeStocks, record } = ozonPushService({ marketplace: 'wb' });
    const features = { ...WB_WRITE, [FEATURE.STOCK_PUSH_SCHEDULE]: true };
    await service.runScheduled('1', features, NOW);
    expect(writeStocks).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'stock-push-schedule', status: 'ok' }),
    );
  });
});

describe('StockSyncProcessor — запись плана', () => {
  function processorWith(apply: ReturnType<typeof vi.fn>) {
    const crmJobs = {
      markActive: vi.fn(async () => undefined),
      finishDone: vi.fn(async () => undefined),
      finishFailed: vi.fn(async () => undefined),
    };
    const processor = new StockSyncProcessor(
      {} as never,
      {} as never,
      {} as never,
      { report: vi.fn() } as never,
      crmJobs as never,
      { apply } as never,
      {} as never,
      { record: vi.fn() } as never,
    );
    return { processor, crmJobs };
  }
  const job = {
    id: 'j',
    name: 'sync-stocks',
    data: { source: 'push', jobId: 'j', telegramUserId: '1', planHash: 'h', features: WRITE },
  } as never;

  it('итог записи — в CrmJobResult', async () => {
    const apply = vi.fn(async () => ({ writes: [{ key: 'c1', written: 1 }] }));
    const { processor, crmJobs } = processorWith(apply);
    await processor.run(job);
    expect(apply).toHaveBeenCalledWith('1', WRITE, 'h', expect.any(Date), undefined);
    expect(crmJobs.finishDone).toHaveBeenCalledWith(
      'j',
      { writes: [{ key: 'c1', written: 1 }] },
      null,
    );
  });

  it('план изменился — failed с текстом для продавца', async () => {
    const { processor, crmJobs } = processorWith(
      vi.fn(async () => {
        throw new StockPushPlanChangedError();
      }),
    );
    await processor.run(job);
    expect(crmJobs.finishFailed).toHaveBeenCalledWith(
      'j',
      expect.stringMatching(/Остатки изменились/),
    );
  });
});

describe('StockPushService.runScheduled — проход по расписанию (TASK-176)', () => {
  it('тот же план и та же запись, что у кнопки; план считается один раз; строка журнала прохода', async () => {
    const { service, writeStocks, record, registry } = pushService();
    const result = await service.runScheduled('1', WRITE, NOW);

    expect(writeStocks).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'c1' }),
      [{ sku: 'A-1', count: 8 }],
      { telegramUserId: '1' },
    );
    expect(result.writes[0]).toMatchObject({ requested: 1, written: 1 });
    // Один план: заказы ЯМ прочитаны один раз (apply(plan.planHash) прочитал бы дважды).
    expect(registry.require.mock.calls.filter(([, cap]) => cap === 'orders')).toHaveLength(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: STOCK_PUSH_SCHEDULE_LOG_KIND,
        status: 'ok',
        action: expect.stringMatching(/записано 1 из 1/),
      }),
    );
  });

  it('сбой чтения заказов — ничего не пишется, алерт и строка журнала с причиной', async () => {
    const { service, writeStocks, report, record } = pushService({ ymOrdersFail: true });
    await service.runScheduled('1', WRITE, NOW);
    expect(writeStocks).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'stock-push:schedule:ym', telegramUserId: '1' }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: STOCK_PUSH_SCHEDULE_LOG_KIND,
        status: 'error',
        action: expect.stringMatching(/заказы одной из площадок не прочитались/),
      }),
    );
  });

  it('сбой чтения остатков — ничего не пишется, алерт', async () => {
    const { service, writeStocks, report } = pushService({ ymStocksFail: true });
    const { plan } = await service.runScheduled('1', WRITE, NOW);
    expect(plan.targets[0].blockedBy).toBe('read-error');
    expect(writeStocks).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'stock-push:schedule:ym' }),
    );
  });

  it('блок держится — алерт один раз; снялся и вернулся — снова', async () => {
    const { service, report } = pushService({ zeroing: true });
    await service.runScheduled('1', WRITE, NOW);
    await service.runScheduled('1', WRITE, NOW);
    const alerts = () =>
      report.mock.calls.filter(
        ([arg]) => (arg as { context: string }).context === 'stock-push:schedule:ym',
      );
    expect(alerts()).toHaveLength(1);
    expect(String((alerts()[0][0] as { error: Error }).error.message)).toMatch(/обнулил бы 6/);
    // Обнуления по кнопке (alertZeroing) расписание не шлёт — у него свой алерт.
    expect(report).not.toHaveBeenCalledWith(
      expect.objectContaining({ context: 'stock-push:zeroing' }),
    );
  });

  it('STOCK_WRITE_ENABLED=false — dry-run: в журнале прохода «что бы записали»', async () => {
    const { service, writeStocks, record } = pushService();
    writeStocks.mockResolvedValueOnce({
      written: 0,
      errors: [],
      skipReason: 'write-disabled',
    } as never);
    await service.runScheduled('1', WRITE, NOW);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: STOCK_PUSH_SCHEDULE_LOG_KIND,
        action: expect.stringMatching(/записано 0 из 1.*проверка без записи.*позиций 1/),
      }),
    );
  });

  it('ни одной фичи записи — отказ до чтения площадок', async () => {
    const { service, writeStocks, registry } = pushService();
    await expect(service.runScheduled('1', { [FEATURE.STOCK_PUSH]: true }, NOW)).rejects.toThrow(
      /stock_push_write_/,
    );
    expect(registry.require).not.toHaveBeenCalled();
    expect(writeStocks).not.toHaveBeenCalled();
  });
});

describe('StockSyncProcessor — проход по расписанию', () => {
  function processorWith(features: Record<string, boolean> | null, runScheduled = vi.fn()) {
    const record = vi.fn();
    const report = vi.fn();
    const featuresFor = vi.fn(async () => features);
    const processor = new StockSyncProcessor(
      {} as never,
      {} as never,
      {} as never,
      { report } as never,
      {} as never,
      { runScheduled } as never,
      { featuresFor } as never,
      { record } as never,
    );
    return { processor, record, report, runScheduled, featuresFor };
  }
  const job = {
    id: 'repeat:x',
    name: 'sync-stocks',
    data: { source: 'schedule', telegramUserId: '1' },
  } as never;

  it('фичи перечитываются в момент прохода и уходят в runScheduled', async () => {
    const { processor, runScheduled, featuresFor } = processorWith(WRITE);
    await processor.run(job);
    expect(featuresFor).toHaveBeenCalledWith('1');
    expect(runScheduled).toHaveBeenCalledWith('1', WRITE);
  });

  it('расписание закрыли после заведения — не пишет, строка «пропущено»', async () => {
    const { processor, runScheduled, record } = processorWith(null);
    await processor.run(job);
    expect(runScheduled).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: STOCK_PUSH_SCHEDULE_LOG_KIND,
        action: expect.stringMatching(/пропущено/),
      }),
    );
  });

  it('сбой прохода не пробрасывается: журнал ошибок и строка прохода', async () => {
    const { processor, record, report } = processorWith(
      WRITE,
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    await expect(processor.run(job)).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'stock-push:schedule' }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: STOCK_PUSH_SCHEDULE_LOG_KIND, status: 'error' }),
    );
  });
});
