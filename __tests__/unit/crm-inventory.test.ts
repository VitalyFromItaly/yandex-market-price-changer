import type { ICrmInventoryView } from '../../src/modules/crm/inventory/crm-inventory.domain';

import { describe, expect, it, vi } from 'vitest';

import { CRM_SECTIONS } from '../../src/modules/crm/crm-features.domain';
import {
  INVENTORY_KIND,
  NOT_CONNECTED_TEXT,
  NO_JOURNAL_TEXT,
  OZON_RETURNS_UNAVAILABLE_TEXT,
  toCrmInventory,
} from '../../src/modules/crm/inventory/crm-inventory.domain';
import { CrmInventoryKinds } from '../../src/modules/crm/inventory/crm-inventory.kinds';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { ymStockLevels } from '../../src/modules/marketplaces/marketplace-stocks';
import { FEATURE, FEATURE_META } from '../../src/modules/telegram/bots/shared/features.domain';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';

const SELLER = '111';
const NOW = new Date('2026-10-18T09:00:00Z');

const ALL_OPEN = {
  [FEATURE.INVENTORY]: true,
  [FEATURE.OZON]: true,
  [FEATURE.WB]: true,
  [FEATURE.REPORT_IN_TRANSIT]: true,
  [FEATURE.REPORT_RETURNING]: true,
};

const PRODUCTS = [
  {
    _id: 'p1',
    internalSku: 'A1',
    name: 'Casio A1',
    marketplaceSkus: { ym: 'A1', ozon: 'OZ-A1' },
    stock: 6,
    stockUpdatedAt: new Date('2026-10-17T10:00:00Z'),
    purchase: { price: 1000 },
  },
  { _id: 'p2', internalSku: 'B1', name: 'Casio B1', marketplaceSkus: { ym: 'B1' } },
];

interface IFakes {
  ymStocks?: ReturnType<typeof vi.fn>;
  ozonStocks?: ReturnType<typeof vi.fn>;
  ozonOrders?: ReturnType<typeof vi.fn>;
  months?: Array<{ status: string | null; from: string }>;
}

function kinds(fakes: IFakes = {}) {
  const ymStocks =
    fakes.ymStocks ??
    vi.fn(async () => ymStockLevels({ placement: 'FBY', takenAt: NOW, stocks: { A1: 4, B1: 2 } }));
  const ozonStocks =
    fakes.ozonStocks ??
    vi.fn(async () => ({
      takenAt: NOW,
      placement: null,
      byLocation: {
        seller: { 'OZ-A1': { available: 6, reserved: 1 } },
        marketplace: { 'OZ-A1': { available: 2, reserved: 0 } },
      },
    }));
  const ozonOrders =
    fakes.ozonOrders ??
    vi.fn(async () => ({
      orders: [
        { stage: 'in_transit', items: [{ sku: 'OZ-A1', count: 1 }] },
        { stage: 'redeemed', items: [{ sku: 'OZ-A1', count: 5 }] },
      ],
      cancelled: [],
    }));
  const capabilities: Record<string, Record<string, unknown>> = {
    ym: { stocks: { listStocks: ymStocks } },
    ozon: { stocks: { listStocks: ozonStocks }, orders: { listOrders: ozonOrders } },
  };
  const marketplaces = {
    capability: (mp: string, cap: string) => capabilities[mp]?.[cap] ?? null,
    require: (mp: string, cap: string) => capabilities[mp][cap],
  };
  const reports = {
    build: vi.fn(async (_store: unknown, key: string) =>
      key === REPORT.IN_TRANSIT
        ? { orders: [{ items: [{ offerId: 'A1', count: 2 }] }] }
        : {
            orders: [],
            returns: { records: [{ items: [{ offerId: 'B1', count: 1 }] }] },
          },
    ),
  };
  const finance = {
    build: vi.fn(
      async (_uid: string, _period: unknown, _now: Date, options: { marketplace: string }) => ({
        months: fakes.months ?? [{ status: 'verified', from: '2026-09-01' }],
        pnl: {
          skus: {
            // Журнал Ozon ключуется ключом закупа — артикулом ЯМ товара.
            skus:
              options.marketplace === 'ym'
                ? [{ sku: 'A1', units: 28 }]
                : [{ sku: 'A1', units: 14 }],
          },
        },
      }),
    ),
  };
  const products = {
    findByMarketplaceSkus: vi.fn(async (_uid: string, mp: string, skus: string[]) =>
      PRODUCTS.filter((p) => skus.includes((p.marketplaceSkus as Record<string, string>)[mp])),
    ),
    // Как `ProductService.findByJournalSkus`: сначала артикул ЯМ, затем артикул площадки.
    findByJournalSkus: vi.fn(
      async (_uid: string, mp: string, skus: string[]) =>
        new Map(
          skus.flatMap((sku) => {
            const found =
              PRODUCTS.find((p) => p.marketplaceSkus.ym === sku) ??
              (mp === 'ym'
                ? undefined
                : PRODUCTS.find((p) => (p.marketplaceSkus as Record<string, string>)[mp] === sku));
            return found ? [[sku, found] as const] : [];
          }),
        ),
    ),
    findWithOwnStock: vi.fn(async () => PRODUCTS.filter((p) => (p.stock ?? 0) > 0)),
  };
  const catalog = {
    costsFor: vi.fn(
      async (_uid: string, items: Array<{ id: string; purchase?: { price: number } | null }>) =>
        new Map(items.map((item) => [item.id, item.purchase ? item.purchase.price : null])),
    ),
  };
  const register = vi.fn();
  const service = new InventoryService(
    marketplaces as never,
    reports as never,
    finance as never,
    products as never,
    catalog as never,
  );
  const instance = new CrmInventoryKinds({ register } as never, service);
  /** Сборка без площадки — как её зовут правила уведомлений: все открытые площадки. */
  const aggregate = async (features: Record<string, boolean> = ALL_OPEN) => {
    const ctx = context(features);
    const snapshot = await service.build({ ...ctx, now: NOW, movements: true });
    return toCrmInventory(snapshot.inventory, {
      now: NOW,
      marketplace: 'ym',
      columns: snapshot.columns,
      problems: snapshot.problems,
      notes: snapshot.notes,
    });
  };
  return { instance, aggregate, register, ymStocks, ozonStocks, ozonOrders, reports, finance };
}

const context = (features: Record<string, boolean> = ALL_OPEN, params = {}) =>
  ({
    telegramUserId: SELLER,
    store: { telegramUserId: SELLER, name: 'Магазин', campaign_id: 'c1' } as never,
    params,
    features,
  }) as const;

describe('«Склад» — inventory:summary', () => {
  it('без площадки (уведомления) сводит площадки к товару: свой склад, FBY, FBO отдельно; FBS не в стоимости', async () => {
    const { aggregate, reports } = kinds();
    const view = await aggregate();

    expect(view.columns.map((c) => [c.marketplace, c.places.marketplace, c.hasReserve])).toEqual([
      ['ym', 'FBY', false],
      ['ozon', 'FBO', true],
    ]);
    const a1 = view.rows.find((row) => row.internalSku === 'A1');
    expect(a1).toMatchObject({
      ownStock: 6,
      atMarketplaces: 4 + 2,
      inTransit: 2 + 1,
      // Свой склад 6 + FBY 4 + FBO 2 = 12 шт. × 1 000 ₽; FBS Ozon (6) — тот же свой склад.
      valueKopecks: 12 * 100_000,
      // ЯМ 28 + Ozon 14 за 28 дней = 1,5 шт./день.
      unitsPerDay: 1.5,
      daysLeft: 8,
    });
    expect(a1?.byMarketplace.ozon?.returning).toBeNull();
    expect(view.rows.find((row) => row.internalSku === 'B1')).toMatchObject({
      returning: 1,
      valueKopecks: null,
    });
    expect(view.totals.withoutCost).toEqual({ products: 1, units: 2 });
    expect(view.notes).toContain(OZON_RETURNS_UNAVAILABLE_TEXT);
    // FBY ЯМ — через адаптер, отдельного отчёта остатков kind не заказывает.
    expect(reports.build.mock.calls.map(([, key]) => key)).toEqual([
      REPORT.IN_TRANSIT,
      REPORT.RETURNING,
    ]);
  });

  it('закрытая ozon — колонки нет и запросов к Ozon нет', async () => {
    const { aggregate, ozonStocks, ozonOrders, finance } = kinds();
    const view = await aggregate({ ...ALL_OPEN, [FEATURE.OZON]: false });
    expect(view.columns.map((c) => c.marketplace)).toEqual(['ym']);
    expect(ozonStocks).not.toHaveBeenCalled();
    expect(ozonOrders).not.toHaveBeenCalled();
    expect(finance.build.mock.calls.map(([, , , options]) => options.marketplace)).toEqual(['ym']);
  });

  it('закрытые отчёты ЯМ — в пути и возвраты «нет данных», запросов нет', async () => {
    const { instance, reports } = kinds();
    const { data } = await instance.summary(
      context({
        ...ALL_OPEN,
        [FEATURE.REPORT_IN_TRANSIT]: false,
        [FEATURE.REPORT_RETURNING]: false,
        [FEATURE.OZON]: false,
      }),
      NOW,
    );
    expect(reports.build).not.toHaveBeenCalled();
    expect(
      (data as ICrmInventoryView).rows.find((r) => r.internalSku === 'A1')?.inTransit,
    ).toBeNull();
  });

  it('сбой магазина и неподключённый Ozon — строки с причиной, а не нули', async () => {
    const { aggregate } = kinds({
      ymStocks: vi.fn().mockRejectedValue(new Error('boom')),
      ozonStocks: vi
        .fn()
        .mockRejectedValue(new MarketplaceNotConnectedError('ozon', SELLER, 'no-credentials')),
    });
    const view = await aggregate();
    expect(view.problems).toEqual([
      expect.objectContaining({ marketplace: 'ym', storeName: 'Магазин' }),
      { marketplace: 'ozon', storeName: null, problem: NOT_CONNECTED_TEXT('ozon') },
    ]);
    expect(view.columns.find((c) => c.marketplace === 'ozon')?.state).toBe('not-connected');
    // Свой склад из прайса всё равно виден.
    expect(view.rows.find((r) => r.internalSku === 'A1')?.ownStock).toBe(6);
  });

  it('/ym (TASK-182) — только ЯМ: Ozon не запрашивается, скорость по журналу ЯМ', async () => {
    const { instance, ozonStocks, ozonOrders, finance } = kinds();
    const view = (await instance.summary(context(), NOW)).data as ICrmInventoryView;
    expect(view.marketplace).toBe('ym');
    expect(view.columns.map((c) => c.marketplace)).toEqual(['ym']);
    expect(ozonStocks).not.toHaveBeenCalled();
    expect(ozonOrders).not.toHaveBeenCalled();
    expect(finance.build.mock.calls.map(([, , , options]) => options.marketplace)).toEqual(['ym']);
    expect(view.rows.find((row) => row.internalSku === 'A1')).toMatchObject({
      atMarketplaces: 4,
      inTransit: 2,
      // ЯМ 28 за 28 дней = 1 шт./день; свой склад 6 + FBY 4.
      unitsPerDay: 1,
      daysLeft: 10,
    });
    expect(view.notes).not.toContain(OZON_RETURNS_UNAVAILABLE_TEXT);
  });

  it('/ozon — только Ozon: ни остатков, ни отчётов ЯМ; товар по ключу закупа журнала', async () => {
    const { instance, ymStocks, reports, finance } = kinds();
    const view = (await instance.summary(context(ALL_OPEN, { marketplace: 'ozon' }), NOW))
      .data as ICrmInventoryView;
    expect(view.marketplace).toBe('ozon');
    expect(view.columns.map((c) => c.marketplace)).toEqual(['ozon']);
    expect(ymStocks).not.toHaveBeenCalled();
    expect(reports.build).not.toHaveBeenCalled();
    expect(finance.build.mock.calls.map(([, , , options]) => options.marketplace)).toEqual([
      'ozon',
    ]);
    expect(view.rows.map((row) => row.internalSku)).toEqual(['A1']);
    expect(view.rows[0]).toMatchObject({
      atMarketplaces: 2,
      inTransit: 1,
      // Ozon 14 за 28 дней = 0,5 шт./день.
      unitsPerDay: 0.5,
    });
    expect(Object.keys(view.rows[0].byMarketplace)).toEqual(['ozon']);
  });

  it('площадка: мусор и закрытая фича — отказ, а не тихий ЯМ', async () => {
    const { instance } = kinds();
    await expect(
      instance.summary(context(ALL_OPEN, { marketplace: 'amazon' }), NOW),
    ).rejects.toThrow('Площадка указана неверно');
    await expect(
      instance.summary(context({ ...ALL_OPEN, [FEATURE.WB]: false }, { marketplace: 'wb' }), NOW),
    ).rejects.toThrow('«Wildberries» закрыта');
  });

  it('журнал окна не загружен — скорости нет, причина строкой', async () => {
    const { instance } = kinds({ months: [{ status: null, from: '2026-09-01' }] });
    const { data } = await instance.summary(context({ ...ALL_OPEN, [FEATURE.OZON]: false }), NOW);
    const view = data as ICrmInventoryView;
    expect(view.problems).toContainEqual({
      marketplace: 'ym',
      storeName: null,
      problem: NO_JOURNAL_TEXT('ym', '09.2026'),
    });
    expect(view.rows.find((r) => r.internalSku === 'A1')?.daysLeft).toBeNull();
  });

  it('kind аккаунта под inventory; фича выключена и требует «Финансы»', () => {
    const { instance, register } = kinds();
    instance.onModuleInit();
    expect(register).toHaveBeenCalledWith(
      INVENTORY_KIND,
      expect.objectContaining({ features: [FEATURE.INVENTORY], scope: 'account' }),
    );
    expect(CRM_SECTIONS['ym-inventory']).toEqual([FEATURE.INVENTORY]);
    expect(FEATURE_META[FEATURE.INVENTORY].defaultEnabled).toBe(false);
    expect(FEATURE_META[FEATURE.INVENTORY].requires).toEqual([FEATURE.FINANCE]);
  });
});
