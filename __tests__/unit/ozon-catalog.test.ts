import { Logger } from '@nestjs/common';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OzonCatalogService,
  OzonNotConnectedError,
  ozonStockLevels,
} from '../../src/modules/ozon/ozon-catalog.service';
import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import {
  OzonMarketplaceAdapter,
  ozonMarketplaceStocks,
} from '../../src/modules/ozon/ozon-marketplace.adapter';
import {
  OZON_INFO_BATCH,
  OZON_PATHS,
  OzonSellerClient,
  mapProductInfo,
  mapProductList,
  mapStocks,
} from '../../src/modules/ozon/ozon.client';

const API_KEY = 'aaaaaaaa-SECRET-bbbb-cccc-0123456789ab';

/**
 * axios.create → фейк, отвечающий по пути: у каталога три метода, и порядок
 * вызовов между ними — часть проверяемого поведения.
 */
function stubRoutes(routes: Record<string, (body: any) => unknown>) {
  const calls: Array<{ path: string; body: any }> = [];
  let onError: (e: unknown) => unknown = (e) => {
    throw e;
  };
  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: { response: { use: (_ok: unknown, err: any) => (onError = err) } },
        post: async (path: string, body: any) => {
          calls.push({ path, body });
          try {
            return { data: await routes[path](body) };
          } catch (raw) {
            return onError(raw);
          }
        },
      }) as never,
  );
  return calls;
}

const client = () =>
  new OzonSellerClient(
    'https://api-seller.ozon.ru',
    { clientId: '1', apiKey: API_KEY },
    { sleep: async () => undefined },
  );

describe('OzonSellerClient: каталог и остатки', () => {
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

  it('список по last_id, описание батчами по product_id; offer_id и архив — из списка, если info молчит', async () => {
    const total = OZON_INFO_BATCH + 5;
    const ids = Array.from({ length: total }, (_, i) => i + 1);
    const calls = stubRoutes({
      [OZON_PATHS.productList]: (body) =>
        body.last_id === ''
          ? {
              result: {
                items: ids.slice(0, 100).map((id) => ({ product_id: id, offer_id: `OF-${id}` })),
                last_id: 'p2',
              },
            }
          : body.last_id === 'p2'
            ? {
                result: {
                  items: ids.slice(100).map((id) => ({
                    product_id: id,
                    offer_id: `OF-${id}`,
                    archived: id === total,
                  })),
                  last_id: 'p3',
                },
              }
            : { result: { items: [], last_id: '' } },
      [OZON_PATHS.productInfoList]: (body) => ({
        items: body.product_id.map((id: string) => ({
          id: Number(id),
          offer_id: id === '1' ? '' : `OF-${id}`,
          name: `Товар ${id}`,
          barcodes: [`46${id}`],
          price: '1990.0000',
          currency_code: 'RUB',
          sources: [{ sku: 9000 + Number(id), source: 'sds' }],
        })),
      }),
    });

    const products = await client().listProducts();

    expect(products).toHaveLength(total);
    expect(products[0]).toEqual({
      productId: '1',
      offerId: 'OF-1',
      name: 'Товар 1',
      barcodes: ['461'],
      sku: '9001',
      skus: ['9001'],
      price: 1990,
      currency: 'RUB',
      archived: false,
    });
    expect(products.find((p) => p.productId === String(total))?.archived).toBe(true);
    const listCalls = calls.filter((c) => c.path === OZON_PATHS.productList);
    expect(listCalls.map((c) => c.body.last_id)).toEqual(['', 'p2', 'p3']);
    expect(listCalls[0].body).toEqual({ filter: { visibility: 'ALL' }, last_id: '', limit: 1000 });
    const infoCalls = calls.filter((c) => c.path === OZON_PATHS.productInfoList);
    expect(infoCalls.map((c) => c.body.product_id.length)).toEqual([OZON_INFO_BATCH, 5]);
  });

  it('повтор last_id/cursor обрывает обход, а не крутит его вечно', async () => {
    const calls = stubRoutes({
      [OZON_PATHS.productList]: () => ({ result: { items: [{ product_id: 1 }], last_id: 'same' } }),
      [OZON_PATHS.productInfoList]: () => ({ items: [] }),
      [OZON_PATHS.productStocks]: () => ({ items: [{ offer_id: 'A', stocks: [] }], cursor: 'c' }),
    });

    await client().listProducts();
    await client().loadStocks();

    expect(calls.filter((c) => c.path === OZON_PATHS.productList)).toHaveLength(2);
    expect(calls.filter((c) => c.path === OZON_PATHS.productStocks)).toHaveLength(2);
  });

  it('остатки: FBO и FBS раздельно, незнакомый тип не складывается никуда, 429 повторяется', async () => {
    let attempts = 0;
    const calls = stubRoutes({
      [OZON_PATHS.productStocks]: (body) => {
        attempts += 1;
        if (attempts === 1) {
          const error: any = new Error('Request failed with status code 429');
          error.config = {
            method: 'post',
            url: OZON_PATHS.productStocks,
            headers: { 'Api-Key': API_KEY },
          };
          error.response = { status: 429, data: { code: 8, message: 'rate' }, headers: {} };
          throw error;
        }
        return body.cursor === ''
          ? {
              items: [
                {
                  product_id: 1,
                  offer_id: 'A',
                  stocks: [
                    { type: 'fbo', present: 5, reserved: 1 },
                    { type: 'fbs', present: 2, reserved: 0 },
                    { type: 'crossborder', present: 100, reserved: 0 },
                  ],
                },
              ],
              cursor: 'next',
            }
          : { items: [], cursor: '' };
      },
    });

    expect(await client().loadStocks()).toEqual([
      {
        productId: '1',
        offerId: 'A',
        fbo: { present: 5, reserved: 1 },
        fbs: { present: 2, reserved: 0 },
      },
    ]);
    expect(calls.map((c) => c.body.cursor)).toEqual(['', '', 'next']);
    expect(logged.join('\n')).not.toContain(API_KEY);
  });
});

describe('разбор ответов каталога', () => {
  it('читает и result.*, и верхний уровень; мусор отбрасывается', () => {
    expect(
      mapProductList({ items: [{ product_id: 7, offer_id: 'X' }, null, {}], last_id: 'n' }),
    ).toEqual({
      items: [{ productId: '7', offerId: 'X', archived: false }],
      lastId: 'n',
    });
    expect(
      mapProductInfo({ result: { items: [{ id: 3, barcode: '1', barcodes: ['1', ''] }] } }),
    ).toEqual([
      {
        productId: '3',
        offerId: '',
        name: undefined,
        barcodes: ['1'],
        sku: undefined,
        skus: [],
        price: undefined,
        currency: undefined,
        archived: false,
      },
    ]);
    expect(mapStocks({ result: { items: [], cursor: 'z' } })).toEqual({ items: [], cursor: 'z' });
    expect(mapStocks(null)).toEqual({ items: [], cursor: '' });
  });
});

describe('OzonCatalogService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('нет ключа — OzonNotConnectedError, клиент не создаётся', async () => {
    const forCredentials = vi.fn();
    const service = new OzonCatalogService(
      { forCredentials } as never,
      { credentialsOf: async () => null } as never,
    );
    await expect(service.stocks('111')).rejects.toBeInstanceOf(OzonNotConnectedError);
    expect(forCredentials).not.toHaveBeenCalled();
  });

  it('остатки по артикулу: повтор складывается по типу склада, без общей суммы', async () => {
    const now = new Date('2026-10-16T09:00:00Z');
    const credentialsOf = vi.fn(async () => ({ clientId: '1', apiKey: API_KEY }));
    const loadStocks = vi.fn(async () => [
      {
        productId: '1',
        offerId: 'A',
        fbo: { present: 1, reserved: 0 },
        fbs: { present: 2, reserved: 1 },
      },
      {
        productId: '2',
        offerId: 'A',
        fbo: { present: 3, reserved: 1 },
        fbs: { present: 0, reserved: 0 },
      },
      {
        productId: '3',
        offerId: ' ',
        fbo: { present: 9, reserved: 0 },
        fbs: { present: 9, reserved: 0 },
      },
    ]);
    const service = new OzonCatalogService(
      { forCredentials: () => ({ loadStocks }) } as never,
      { credentialsOf } as never,
    );

    expect(await service.stocks('111', now)).toEqual({
      takenAt: now,
      stocks: { A: { fbo: { present: 4, reserved: 1 }, fbs: { present: 2, reserved: 1 } } },
    });
    expect(credentialsOf).toHaveBeenCalledWith('111', 'ozon');
    expect(ozonStockLevels([])).toEqual({});
  });
});

/** Ozon в реестре (TASK-163): каталог и остатки — нашими сущностями. */
describe('OzonMarketplaceAdapter: каталог и остатки', () => {
  const REF = { telegramUserId: '111', marketplace: 'ozon' as const };

  function adapter(catalog: Partial<OzonCatalogService>) {
    return new OzonMarketplaceAdapter({} as never, {} as never, catalog as never);
  }

  it('остатки: FBO — склад Ozon, FBS — склад продавца, без суммы; доступно = лежит − резерв', async () => {
    const now = new Date('2026-10-18T07:00:00Z');
    const stocks = vi.fn(async () => ({
      takenAt: now,
      stocks: { A: { fbo: { present: 4, reserved: 1 }, fbs: { present: 2, reserved: 2 } } },
    }));
    expect(await adapter({ stocks }).stocks.listStocks(REF, now)).toEqual({
      takenAt: now,
      placement: null,
      byLocation: {
        marketplace: { A: { available: 3, reserved: 1 } },
        seller: { A: { available: 0, reserved: 2 } },
      },
    });
    expect(stocks).toHaveBeenCalledWith('111', now);
    expect(ozonMarketplaceStocks({ takenAt: now, stocks: {} }).byLocation).toEqual({
      marketplace: {},
      seller: {},
    });
  });

  it('каталог — строки товаров с признаком архива', async () => {
    const products = vi.fn(async () => [
      { productId: '1', offerId: 'A', barcodes: ['1'], archived: false },
      { productId: '2', offerId: 'B', barcodes: [], archived: true },
    ]);
    expect(await adapter({ products } as never).catalog.listProducts(REF)).toEqual([
      { sku: 'A', name: undefined, barcodes: ['1'], salePrice: undefined },
      { sku: 'B', name: undefined, barcodes: [], salePrice: undefined, archived: true },
    ]);
  });

  it('нет ключа — отказ реестра, прочие сбои — как есть', async () => {
    const missing = adapter({
      stocks: async () => {
        throw new OzonNotConnectedError('111');
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
