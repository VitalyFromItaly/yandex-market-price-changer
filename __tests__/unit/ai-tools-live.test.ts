import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  AI_GATED_FEATURES,
  AI_TOOL,
  liveStoreOf,
  STORE_NOT_FOUND_TEXT,
} from '../../src/modules/ai-tools/ai-tools.domain';
import { AiToolsService } from '../../src/modules/ai-tools/ai-tools.service';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import { StockLevelsService } from '../../src/modules/yandex/stocks/stock-levels.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import {
  YandexNetworkError,
  YandexRateLimitError,
} from '../../src/modules/yandex/yandex-api.errors';

/**
 * Живые инструменты Маркета (TASK-166): числа — ровно те, что отдают сервисы
 * экранов (`StockLevelsService.levels`, `OrderReportsService.build(RETURNING)`),
 * поверх заглушки клиента Partner API.
 */

const SELLER = '111';
const NOW = new Date('2026-08-03T10:00:00+03:00');
const STORE = {
  telegramUserId: SELLER,
  token: 'ACMA:x',
  campaign_id: '10',
  business_id: '20',
  name: 'Часы',
  stores: [
    {
      campaignId: '10',
      businessId: '20',
      businessName: 'ИП',
      storeName: 'Часы',
      placementType: 'FBS',
    },
    {
      campaignId: '11',
      businessId: '20',
      businessName: 'ИП',
      storeName: 'Склад Маркета',
      placementType: 'FBY',
    },
  ],
};

const totals = (available: number) => ({ AVAILABLE: available, FIT: available + 1 });

const PRODUCTS = [
  { name: 'Часы Casio F-91W', category: 'Наручные часы', marketplaceSkus: { ym: 'C1' } },
  { name: 'Часы Casio A158', category: 'Наручные часы', marketplaceSkus: { ym: 'C2' } },
  { name: 'Ремешок кожаный', category: 'Аксессуары', marketplaceSkus: { ym: 'R1' } },
];

const ret = (id: number, creationDate: string, shipmentStatus = 'IN_TRANSIT') => ({
  returnId: id,
  orderId: 1000 + id,
  creationDate,
  shipmentStatus,
  amount: { value: 100 },
});

async function setup(
  opts: {
    stocksFail?: Error;
    returnsFail?: Error;
    fbyError?: 'rate_limit' | 'generic';
    returns?: unknown[];
  } = {},
) {
  const client = {
    loadStocks: vi.fn(async () => {
      if (opts.stocksFail) throw opts.stocksFail;
      return [
        { warehouseId: 1, offerId: 'C1', stocks: [{ type: 'AVAILABLE', count: 2 }] },
        { warehouseId: 1, offerId: 'C2', stocks: [{ type: 'AVAILABLE', count: 15 }] },
        { warehouseId: 1, offerId: 'R1', stocks: [{ type: 'AVAILABLE', count: 1 }] },
      ];
    }),
    listStoreWarehouses: vi.fn(async () => [{ id: 1 }]),
    updateStocks: vi.fn(),
    async *iterateOrders() {
      // Невыкупов нет — только возвраты.
    },
    async *iterateReturns() {
      if (opts.returnsFail) throw opts.returnsFail;
      if (opts.returns?.length) yield opts.returns;
    },
    listStores: vi.fn(async () => []),
  };
  const fbyStock = {
    safeLoad: vi.fn(async () =>
      opts.fbyError
        ? { snapshot: null, error: opts.fbyError }
        : {
            snapshot: {
              takenAt: new Date('2026-08-03T06:00:00Z'),
              summary: {
                rows: [
                  { sku: 'C1', warehouse: 'Ростов', totals: totals(3) },
                  { sku: 'C1', warehouse: 'Москва', totals: totals(4) },
                ],
              },
            },
          },
    ),
  };
  const errors = { report: vi.fn(async () => undefined) };
  const stockLevels = new StockLevelsService(
    { forTenant: () => client } as never,
    fbyStock as never,
    { placementFor: vi.fn(async () => undefined) } as never,
    errors as never,
  );
  const moduleRef = await Test.createTestingModule({
    providers: [
      OrderReportsService,
      { provide: YandexClientFactory, useValue: { forStore: vi.fn(() => client) } },
    ],
  }).compile();
  const orderReports = moduleRef.get(OrderReportsService);
  const tools = new AiToolsService(
    {} as never,
    {} as never,
    {
      findByYmSkus: async (_uid: string, skus: string[]) =>
        PRODUCTS.filter((p) => skus.includes(p.marketplaceSkus.ym)),
    } as never,
    errors as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    { findByTelegramUser: async () => STORE } as never,
    stockLevels,
    orderReports,
  );
  const call = (name: string, args: unknown) =>
    tools
      .toolbox(SELLER, () => NOW, { features: new Set(AI_GATED_FEATURES) })
      .call(name, JSON.stringify(args)) as Promise<{
      ok: boolean;
      data?: Record<string, never>;
      error?: string;
      reason?: string;
      sourceRefs?: { source: string };
    }>;
  return { call, stockLevels, orderReports, errors, fbyStock, client };
}

describe('getStocks — те же числа, что «Склад»', () => {
  it('FBS: каждый артикул == levels(), от меньшего остатка, названия из каталога', async () => {
    const { call, stockLevels } = await setup();
    const levels = await stockLevels.levels(STORE as never, NOW);
    const result = await call(AI_TOOL.STOCKS, {});

    expect(result.ok).toBe(true);
    expect(result.sourceRefs?.source).toBe('yandex:stocks');
    expect(result.data).toMatchObject({ store: 'Часы', model: 'FBS', total: 3, threshold: 3 });
    const rows = (result.data as { rows: { sku: string; available: number }[] }).rows;
    expect(Object.fromEntries(rows.map((r) => [r.sku, r.available]))).toEqual(levels.stocks);
    expect(rows.map((r) => r.sku)).toEqual(['R1', 'C1', 'C2']);
  });

  it('«что из Casio заканчивается»: brand + onlyLow', async () => {
    const { call } = await setup();
    const result = await call(AI_TOOL.STOCKS, { brand: 'casio', onlyLow: true });

    expect(result.data).toMatchObject({
      total: 1,
      lowCount: 1,
      rows: [{ sku: 'C1', name: 'Часы Casio F-91W', brand: 'CASIO', available: 2, low: true }],
    });
  });

  it('FBY-магазин по названию: снимок FbyStockService, модель FBY, отдельно от FBS', async () => {
    const { call, fbyStock, client } = await setup();
    const result = await call(AI_TOOL.STOCKS, { store: 'Склад Маркета' });

    expect(fbyStock.safeLoad).toHaveBeenCalledTimes(1);
    expect(client.loadStocks).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      store: 'Склад Маркета',
      model: 'FBY',
      rows: [{ sku: 'C1', available: 7 }],
    });
  });

  it('FBY недоступен по лимиту — текст бота, а не выдуманный остаток', async () => {
    const { call } = await setup({ fbyError: 'rate_limit' });
    const result = await call(AI_TOOL.STOCKS, { store: 'Склад Маркета' });
    expect(result).toEqual({ ok: false, error: 'Остатки обновляются, попробуйте через минуту.' });
  });

  it('FBS не ответил — отказ (levels сам пишет в ErrorReporter), ход не падает', async () => {
    const { call, errors } = await setup({ stocksFail: new YandexNetworkError('timeout') });
    const result = await call(AI_TOOL.STOCKS, {});
    expect(result).toEqual({ ok: false, error: 'Остатки временно недоступны.' });
    expect(errors.report).toHaveBeenCalledWith(expect.objectContaining({ source: 'yandex' }));
  });

  it('чужой магазин — отказ со списком своих; кривой бренд — отказ', async () => {
    const { call } = await setup();
    expect(await call(AI_TOOL.STOCKS, { store: 'Чужой' })).toEqual({
      ok: false,
      error: STORE_NOT_FOUND_TEXT('Чужой', ['Часы', 'Склад Маркета']),
    });
    expect((await call(AI_TOOL.STOCKS, { brand: 'rolex' })).ok).toBe(false);
  });
});

describe('getReturns — те же числа, что «Едет обратно»', () => {
  const RETURNS = [
    ret(1, '2026-08-02T12:00:00+03:00'),
    ret(2, '2026-08-01T12:00:00+03:00', 'READY_FOR_PICKUP'),
    ret(3, '2026-08-01T13:00:00+03:00', 'PICKED'),
  ];

  it('count/inFlight/settled == build(RETURNING).returns', async () => {
    const { call, orderReports } = await setup({ returns: RETURNS });
    const report = await orderReports.build(STORE as never, REPORT.RETURNING, NOW, {
      key: PERIOD.MONTH,
    });
    const result = await call(AI_TOOL.RETURNS, { period: 'month' });

    expect(result.ok).toBe(true);
    expect(result.sourceRefs?.source).toBe('yandex:returning');
    expect(result.data).toMatchObject({
      store: 'Часы',
      orders: report.count,
      sales: report.totals.sales,
      returns: {
        count: report.returns?.count,
        inFlight: report.returns?.inFlight,
        settled: report.returns?.settled,
      },
    });
    expect(report.returns?.count).toBe(3);
  });

  it('квота Маркета — toolError с текстом бота, ErrorReporter source yandex и точный context', async () => {
    const { call, errors } = await setup({
      returnsFail: new YandexRateLimitError('too many', 420),
    });
    const result = await call(AI_TOOL.RETURNS, { period: 'all' });

    expect(result).toEqual({
      ok: false,
      error: 'Превышен лимит запросов к Яндекс.Маркету. Отчёт будет готов чуть позже.',
    });
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'yandex',
        context: 'ai-tool:getReturns',
        telegramUserId: SELLER,
      }),
    );
  });

  it('период вне кнопок «Едет обратно» — отказ', async () => {
    const { call } = await setup();
    expect((await call(AI_TOOL.RETURNS, { period: 'prevmonth' })).ok).toBe(false);
  });
});

describe('liveStoreOf', () => {
  it('без магазина — не подключён; без кэша stores — активный по имени документа', () => {
    expect(typeof liveStoreOf(null, undefined)).toBe('string');
    const bare = { token: 't', campaign_id: '10', name: 'Один' } as never;
    expect(liveStoreOf(bare, undefined)).toMatchObject({ name: 'Один', names: ['Один'] });
    expect(liveStoreOf(bare, 'один')).toMatchObject({ name: 'Один' });
  });

  it('два магазина с одним названием — отказ, а не первый попавшийся', () => {
    const doc = {
      ...STORE,
      stores: [...STORE.stores, { ...STORE.stores[1], campaignId: '12' }],
    } as never;
    expect(typeof liveStoreOf(doc, 'Склад Маркета')).toBe('string');
  });

  it('магазин по названию суживается scopeStore до его кампании', () => {
    const live = liveStoreOf(STORE as never, 'Склад Маркета');
    expect(live).toMatchObject({ store: { campaign_id: '11', name: 'Склад Маркета' } });
  });
});
