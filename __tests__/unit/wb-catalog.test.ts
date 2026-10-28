import { Logger } from '@nestjs/common';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { wbCatalogRows } from '../../src/modules/products/product.domain';
import { WbCatalogService, wbStockLevels } from '../../src/modules/wb/wb-catalog.service';
import {
  WbMarketplaceAdapter,
  wbMarketplaceStocks,
} from '../../src/modules/wb/wb-marketplace.adapter';
import { WbNotConnectedError } from '../../src/modules/wb/wb-seller-client';
import {
  WB_CARDS_LIMIT,
  WB_CATEGORY_HOSTS,
  WB_FBW_NMIDS_BATCH,
  WB_FBW_STOCKS_LIMIT,
  WB_PATHS,
  WB_STOCKS_BATCH,
  WbClient,
  mapCards,
  mapSellerStocks,
  mapWarehouses,
  mapWbStocks,
} from '../../src/modules/wb/wb.client';

const TOKEN = 'header.payload.SECRETsignatureSECRET0123456789abcdef';

const CARDS_URL = `${WB_CATEGORY_HOSTS.content}${WB_PATHS.cardsList}`;
const FBW_URL = `${WB_CATEGORY_HOSTS.analytics}${WB_PATHS.wbWarehousesStocks}`;
const WAREHOUSES_URL = `${WB_CATEGORY_HOSTS.marketplace}${WB_PATHS.warehouses}`;
const sellerStocksUrl = (id: string) =>
  `${WB_CATEGORY_HOSTS.marketplace}${WB_PATHS.sellerStocks(id)}`;

/** axios.create → фейк, отвечающий по адресу (образец ozon-catalog.test.ts), get и post. */
function stubRoutes(routes: Record<string, (body: any, config?: any) => unknown>) {
  const calls: Array<{ method: string; url: string; body?: any; config?: any }> = [];
  let onError: (e: unknown) => unknown = (e) => {
    throw e;
  };
  const answer = async (url: string, body: any, config: any) => {
    try {
      return { data: await routes[url](body, config) };
    } catch (raw) {
      return onError(raw);
    }
  };
  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: { response: { use: (_ok: unknown, err: any) => (onError = err) } },
        get: async (url: string, config?: any) => {
          calls.push({ method: 'get', url, config });
          return answer(url, undefined, config);
        },
        post: async (url: string, body: any) => {
          calls.push({ method: 'post', url, body });
          return answer(url, body, undefined);
        },
      }) as never,
  );
  return calls;
}

const client = () => new WbClient(TOKEN, { sleep: async () => undefined });

const card = (nmID: number, vendorCode: string, barcodes: string[][]) => ({
  nmID,
  vendorCode,
  title: `Часы ${vendorCode}`,
  brand: 'Casio',
  sizes: barcodes.map((skus, i) => ({ chrtID: nmID * 10 + i, skus })),
});

describe('WbClient: карточки и остатки', () => {
  let logged: string[];
  beforeEach(() => {
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it('карточки — курсор {updatedAt, nmID} до неполной страницы', async () => {
    const full = Array.from({ length: WB_CARDS_LIMIT }, (_, i) => card(i + 1, `A-${i + 1}`, [[]]));
    const calls = stubRoutes({
      [CARDS_URL]: (body) =>
        body.settings.cursor.nmID === undefined
          ? { cards: full, cursor: { updatedAt: '2026-10-01T00:00:00Z', nmID: 100, total: 100 } }
          : { cards: [card(101, 'B', [['2']])], cursor: { updatedAt: 'x', nmID: 101, total: 1 } },
    });

    const cards = await client().listCards();
    expect(cards).toHaveLength(WB_CARDS_LIMIT + 1);
    expect(cards.at(-1)).toEqual({
      nmID: '101',
      vendorCode: 'B',
      title: 'Часы B',
      brand: 'Casio',
      sizes: [{ chrtID: '1010', barcodes: ['2'] }],
    });
    expect(calls.map((c) => c.body.settings.cursor)).toEqual([
      { limit: WB_CARDS_LIMIT },
      { limit: WB_CARDS_LIMIT, updatedAt: '2026-10-01T00:00:00Z', nmID: 100 },
    ]);
    expect(calls[0].body.settings.filter).toEqual({ withPhoto: -1 });
  });

  it('повтор курсора останавливает обход, а не крутит его по кругу', async () => {
    const full = Array.from({ length: WB_CARDS_LIMIT }, (_, i) => card(i + 1, `A-${i}`, [[]]));
    const calls = stubRoutes({
      [CARDS_URL]: () => ({ cards: full, cursor: { updatedAt: 'same', nmID: 7, total: 100 } }),
    });
    await client().listCards();
    expect(calls).toHaveLength(2);
  });

  it('остатки FBW — POST «Аналитики» по nmIds; FBS — батчами по штрихкодам', async () => {
    const barcodes = Array.from({ length: WB_STOCKS_BATCH + 3 }, (_, i) => `BC${i}`);
    const calls = stubRoutes({
      [FBW_URL]: () => ({
        data: {
          items: [
            {
              nmId: 1,
              chrtId: 10,
              warehouseId: -999999,
              warehouseName: 'Склад WB',
              regionName: 'Склад WB',
              quantity: 4,
              inWayToClient: 2,
              inWayFromClient: 1,
            },
          ],
        },
      }),
      [WAREHOUSES_URL]: () => [{ id: 55, name: 'Мой склад' }, { name: 'без id' }],
      [sellerStocksUrl('55')]: (body) => ({
        stocks: body.skus.slice(0, 1).map((sku: string) => ({ sku, amount: 2 })),
      }),
    });
    const wb = client();

    expect(await wb.loadWbStocks(['1', '', 'мусор'])).toEqual([
      { nmId: '1', chrtId: '10', warehouseName: 'Склад WB', quantity: 4 },
    ]);
    expect(calls[0]).toMatchObject({
      method: 'post',
      body: { nmIds: [1], limit: WB_FBW_STOCKS_LIMIT, offset: 0 },
    });
    expect(await wb.listWarehouses()).toEqual([
      { id: '55', name: 'Мой склад', deliveryType: null },
    ]);
    expect(await wb.loadSellerStocks('55', barcodes)).toEqual([
      { barcode: 'BC0', amount: 2 },
      { barcode: `BC${WB_STOCKS_BATCH}`, amount: 2 },
    ]);
    const batches = calls.filter((c) => c.url === sellerStocksUrl('55'));
    expect(batches.map((c) => c.body.skus.length)).toEqual([WB_STOCKS_BATCH, 3]);
    expect(logged.join('\n')).not.toContain('SECRET');
  });

  it('остатки FBW: nmIds батчами по 1000, offset до неполной страницы, 204 — пусто', async () => {
    const ids = Array.from({ length: WB_FBW_NMIDS_BATCH + 1 }, (_, i) => String(i + 1));
    const row = (nmId: number) => ({ nmId, chrtId: 1, warehouseName: 'Склад WB', quantity: 1 });
    const calls = stubRoutes({
      [FBW_URL]: (body) => {
        if (body.nmIds.length === 1) return '';
        return body.offset === 0
          ? { data: { items: Array.from({ length: WB_FBW_STOCKS_LIMIT }, () => row(1)) } }
          : { data: { items: [row(2)] } };
      },
    });

    const rows = await client().loadWbStocks(ids);
    expect(rows).toHaveLength(WB_FBW_STOCKS_LIMIT + 1);
    expect(calls.map((c) => [c.body.nmIds.length, c.body.offset])).toEqual([
      [WB_FBW_NMIDS_BATCH, 0],
      [WB_FBW_NMIDS_BATCH, WB_FBW_STOCKS_LIMIT],
      [1, 0],
    ]);
    expect(await client().loadWbStocks([])).toEqual([]);
  });

  it('мапперы терпят мусор и не роняют обход', () => {
    expect(mapCards(null)).toEqual({ cards: [], cursor: {}, total: 0 });
    expect(
      mapCards({ cards: [null, { sizes: 'x' }, { nmID: 5, sizes: [{ skus: ['', ' 7 ', 3] }] }] }),
    ).toEqual({
      cards: [
        {
          nmID: '5',
          vendorCode: '',
          title: undefined,
          brand: undefined,
          sizes: [{ chrtID: '', barcodes: ['7'] }],
        },
      ],
      cursor: {},
      total: 0,
    });
    expect(mapWbStocks({ not: 'array' })).toEqual({ rows: [], count: 0 });
    expect(mapWbStocks('')).toEqual({ rows: [], count: 0 });
    expect(mapWbStocks({ data: { items: [{ nmId: 1, quantity: -3 }, { quantity: 5 }] } })).toEqual({
      rows: [{ nmId: '1', chrtId: '', warehouseName: '', quantity: 0 }],
      count: 2,
    });
    expect(mapWarehouses(null)).toEqual([]);
    expect(mapSellerStocks({ stocks: [{ amount: 1 }, { sku: 'X', amount: 'n' }] })).toEqual([
      { barcode: 'X', amount: 0 },
    ]);
  });
});

describe('wbStockLevels и WbCatalogService', () => {
  const now = new Date('2026-10-18T09:00:00Z');
  const cards = [
    { nmID: '1', vendorCode: 'A', sizes: [{ chrtID: '1', barcodes: ['a1', 'a2'] }] },
    { nmID: '2', vendorCode: 'B', sizes: [{ chrtID: '2', barcodes: ['b1'] }] },
  ];

  it('FBW по номеру WB, FBS по штрихкоду через карточки; размеры и склады одного места складываются, места — нет', () => {
    const levels = wbStockLevels(
      cards,
      [
        { nmId: '1', chrtId: '1', warehouseName: 'Склад WB', quantity: 3 },
        { nmId: '1', chrtId: '11', warehouseName: 'Склад WB', quantity: 2 },
        { nmId: '2', chrtId: '2', warehouseName: 'Склад WB', quantity: 1 },
        { nmId: '99', chrtId: '9', warehouseName: 'Склад WB', quantity: 7 },
      ],
      [
        { barcode: 'a1', amount: 5 },
        { barcode: 'a2', amount: 1 },
        { barcode: 'zz', amount: 9 },
      ],
      now,
    );
    expect(levels).toEqual({
      takenAt: now,
      stocks: { A: { fbw: 5, fbs: 6 }, B: { fbw: 1, fbs: 0 } },
      unknownBarcodes: 1,
      unknownNmIds: 1,
    });
  });

  it('нет токена — WbNotConnectedError, клиент не создаётся', async () => {
    const forToken = vi.fn();
    const service = new WbCatalogService(
      { forToken } as never,
      { credentialsOf: async () => null } as never,
    );
    await expect(service.products('111')).rejects.toBeInstanceOf(WbNotConnectedError);
    expect(forToken).not.toHaveBeenCalled();
  });

  it('stocks: штрихкоды карточек уходят на каждый склад продавца', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const loadSellerStocks = vi.fn(async (id: string) =>
      id === '1' ? [{ barcode: 'a1', amount: 1 }] : [{ barcode: 'b1', amount: 2 }],
    );
    const wb = {
      listCards: async () => cards,
      loadWbStocks: vi.fn(async () => []),
      listWarehouses: async () => [
        { id: '1', name: 'Склад 1' },
        { id: '2', name: 'Склад 2' },
      ],
      loadSellerStocks,
    };
    const credentialsOf = vi.fn(async () => ({ token: TOKEN }));
    const service = new WbCatalogService(
      { forToken: () => wb } as never,
      { credentialsOf } as never,
    );

    expect((await service.stocks('111', now)).stocks).toEqual({
      A: { fbw: 0, fbs: 1 },
      B: { fbw: 0, fbs: 2 },
    });
    expect(credentialsOf).toHaveBeenCalledWith('111', 'wb');
    expect(loadSellerStocks.mock.calls.map(([id, codes]) => [id, codes])).toEqual([
      ['1', ['a1', 'a2', 'b1']],
      ['2', ['a1', 'a2', 'b1']],
    ]);
    vi.restoreAllMocks();
  });
});

describe('wbCatalogRows', () => {
  it('артикул — vendorCode, штрихкоды всех размеров, повтор объединяется, цены нет', () => {
    expect(
      wbCatalogRows([
        {
          vendorCode: ' A ',
          title: 'Часы',
          sizes: [{ barcodes: ['1', '2'] }, { barcodes: ['2'] }],
        },
        { vendorCode: 'A', sizes: [{ barcodes: ['3'] }] },
        { vendorCode: '', title: 'без артикула', sizes: [{ barcodes: ['9'] }] },
      ]),
    ).toEqual([{ sku: 'A', name: 'Часы', barcodes: ['1', '2', '3'] }]);
  });
});

/** WB в реестре (TASK-134): каталог и остатки — нашими сущностями. */
describe('WbMarketplaceAdapter: каталог и остатки', () => {
  const REF = { telegramUserId: '111', marketplace: 'wb' as const };
  const adapter = (catalog: Partial<WbCatalogService>) =>
    new WbMarketplaceAdapter({} as never, {} as never, catalog as never);

  it('FBW — склад WB, FBS — склад продавца, без суммы; резерва нет', async () => {
    const now = new Date('2026-10-18T07:00:00Z');
    const stocks = vi.fn(async () => ({
      takenAt: now,
      stocks: { A: { fbw: 4, fbs: 2 } },
      unknownBarcodes: 0,
      unknownNmIds: 0,
    }));
    expect(await adapter({ stocks }).stocks.listStocks(REF, now)).toEqual({
      takenAt: now,
      placement: null,
      byLocation: {
        marketplace: { A: { available: 4, reserved: null } },
        seller: { A: { available: 2, reserved: null } },
      },
    });
    expect(stocks).toHaveBeenCalledWith('111', now);
    expect(
      wbMarketplaceStocks({ takenAt: now, stocks: {}, unknownBarcodes: 0, unknownNmIds: 0 })
        .byLocation,
    ).toEqual({ marketplace: {}, seller: {} });
  });

  it('каталог — строки товаров', async () => {
    const products = vi.fn(async () => [
      { nmID: '1', vendorCode: 'A', sizes: [{ chrtID: '1', barcodes: ['1'] }] },
    ]);
    expect(await adapter({ products }).catalog.listProducts(REF)).toEqual([
      { sku: 'A', name: undefined, barcodes: ['1'] },
    ]);
  });

  it('нет токена — отказ реестра, прочие сбои — как есть', async () => {
    const missing = adapter({
      stocks: async () => {
        throw new WbNotConnectedError('111');
      },
    } as never);
    await expect(missing.stocks.listStocks(REF)).rejects.toBeInstanceOf(
      MarketplaceNotConnectedError,
    );
    const boom = new Error('boom');
    const broken = adapter({
      products: async () => {
        throw boom;
      },
    } as never);
    await expect(broken.catalog.listProducts(REF)).rejects.toBe(boom);
  });
});
