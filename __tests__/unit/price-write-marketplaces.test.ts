import { Logger } from '@nestjs/common';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IWbGoodsPrice } from '../../src/modules/wb/wb.client';

import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { OzonMarketplaceAdapter } from '../../src/modules/ozon/ozon-marketplace.adapter';
import { OzonPriceWriteService } from '../../src/modules/ozon/ozon-price-write.service';
import { OzonNotConnectedError } from '../../src/modules/ozon/ozon-seller-client';
import {
  OZON_PATHS,
  OZON_PRICES_BATCH,
  OzonSellerClient,
  mapPrices,
} from '../../src/modules/ozon/ozon.client';
import { OzonNetworkError, OzonServerError } from '../../src/modules/ozon/ozon.errors';
import { WbMarketplaceAdapter } from '../../src/modules/wb/wb-marketplace.adapter';
import {
  WB_PRICES_NO_ACCESS_TEXT,
  WB_PRICE_SKIP_REASON,
  WbPriceWriteService,
  WbPricesAccessError,
  wbPriceWrites,
} from '../../src/modules/wb/wb-price-write.service';
import {
  WB_CATEGORY_HOSTS,
  WB_PATHS,
  WB_PRICES_LIMIT,
  WbClient,
  mapGoodsPrices,
} from '../../src/modules/wb/wb.client';
import { WbNotConnectedError } from '../../src/modules/wb/wb-seller-client';
import { WbAuthError, WbNetworkError, WbServerError } from '../../src/modules/wb/wb.errors';

/**
 * Цены Ozon и WB (TASK-201): чтение текущих и запись без повторов, без
 * `old_price`/`discount`; `PRICE_WRITE_ENABLED=false` — ни одного запроса.
 */

function axiosFailure(method: string, url: string, status: number | undefined) {
  const error: any = new Error(status ? `Request failed with status code ${status}` : 'timeout');
  error.config = { method, url, headers: {} };
  if (status) error.response = { status, data: { message: 'boom' }, headers: {} };
  return error;
}

/** axios.create → экземпляр, у которого каждый метод отвечает `respond`. */
function stubHttp(respond: (method: string, url: string, body: unknown) => unknown) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  let onError: (error: unknown) => unknown = (e) => {
    throw e;
  };
  const method =
    (name: string) =>
    async (url: string, bodyOrConfig?: unknown): Promise<unknown> => {
      calls.push({ method: name, url, body: bodyOrConfig });
      try {
        return { data: await respond(name, url, bodyOrConfig) };
      } catch (raw) {
        return onError(raw);
      }
    };
  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: {
          response: { use: (_ok: unknown, err: (e: unknown) => unknown) => (onError = err) },
        },
        get: method('get'),
        post: method('post'),
      }) as never,
  );
  return calls;
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('OzonSellerClient — цены', () => {
  const sleep = vi.fn(async () => undefined);
  const client = () =>
    new OzonSellerClient('https://ozon', { clientId: '1', apiKey: 'k' }, { sleep });

  it('запись: только offer_id, price строкой и рубли — без old_price', async () => {
    const calls = stubHttp(() => ({
      result: [
        { offer_id: 'A', updated: true, errors: [] },
        { offer_id: 'B', updated: false, errors: [{ message: 'цена ниже минимальной' }] },
      ],
    }));
    const rows = await client().updatePrices([
      { offerId: 'A', price: 1990 },
      { offerId: 'B', price: 10 },
    ]);
    expect(calls).toEqual([
      {
        method: 'post',
        url: OZON_PATHS.pricesWrite,
        body: {
          prices: [
            { offer_id: 'A', price: '1990', currency_code: 'RUB' },
            { offer_id: 'B', price: '10', currency_code: 'RUB' },
          ],
        },
      },
    ]);
    expect(rows).toEqual([
      { offerId: 'A', updated: true, message: undefined },
      { offerId: 'B', updated: false, message: 'цена ниже минимальной' },
    ]);
  });

  it.each([
    [503, OzonServerError],
    [undefined, OzonNetworkError],
  ])('запись: %s — ровно один запрос, без паузы', async (status, errorClass) => {
    const calls = stubHttp((method, url) => {
      throw axiosFailure(method, url, status);
    });
    await expect(client().updatePrices([{ offerId: 'A', price: 1 }])).rejects.toBeInstanceOf(
      errorClass,
    );
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('чтение: фильтр по артикулам, курсор до пустого, батчи по 1000', async () => {
    const skus = Array.from({ length: OZON_PRICES_BATCH + 1 }, (_, i) => `S${i}`);
    const calls = stubHttp((_method, _url, body: any) => {
      if (body.filter.offer_id.length === 1) return { items: [], cursor: '' };
      return body.cursor
        ? { items: [{ offer_id: 'S1', price: { price: '250.00' } }], cursor: 'c1' }
        : { items: [{ offer_id: 'S0', price: { price: 1990 } }], cursor: 'c1' };
    });
    const prices = await client().getPrices(skus);
    expect(calls.map((call: any) => [call.url, call.body.cursor, call.body.filter.offer_id.length]))
      .toEqual([
        [OZON_PATHS.productPrices, '', OZON_PRICES_BATCH],
        [OZON_PATHS.productPrices, 'c1', OZON_PRICES_BATCH],
        [OZON_PATHS.productPrices, '', 1],
      ]);
    expect((calls[0].body as any).filter.visibility).toBe('ALL');
    expect(prices).toEqual([
      { offerId: 'S0', price: 1990 },
      { offerId: 'S1', price: 250 },
    ]);
  });

  it('маппер цен: ноль и мусор — null, без артикула — отброшено', () => {
    expect(
      mapPrices({
        items: [
          { offer_id: 'A', price: { price: '0' } },
          { offer_id: 'B', price: {} },
          { price: { price: 5 } },
        ],
        cursor: 'x',
      }),
    ).toEqual({
      items: [
        { offerId: 'A', price: null },
        { offerId: 'B', price: null },
      ],
      cursor: 'x',
    });
  });
});

describe('WbClient — цены', () => {
  const sleep = vi.fn(async () => undefined);
  const client = () => new WbClient('token', { sleep });

  it('запись: POST на хост цен, только nmID и price — без discount', async () => {
    const calls = stubHttp(() => ({ data: { id: 1 }, error: false }));
    await client().uploadPrices([{ nmId: '123', price: 2500 }]);
    expect(calls).toEqual([
      {
        method: 'post',
        url: `${WB_CATEGORY_HOSTS.prices}${WB_PATHS.pricesUpload}`,
        body: { data: [{ nmID: 123, price: 2500 }] },
      },
    ]);
  });

  it.each([
    [503, WbServerError],
    [undefined, WbNetworkError],
  ])('запись: %s — ровно один запрос, без паузы', async (status, errorClass) => {
    const calls = stubHttp((method, url) => {
      throw axiosFailure(method, url, status);
    });
    await expect(client().uploadPrices([{ nmId: '1', price: 1 }])).rejects.toBeInstanceOf(
      errorClass,
    );
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('чтение: страницы limit/offset до неполной', async () => {
    const full = Array.from({ length: WB_PRICES_LIMIT }, (_, i) => ({
      nmID: i + 1,
      vendorCode: `V${i}`,
      sizes: [{ price: 100 }],
      discount: 10,
    }));
    const calls = stubHttp((_method, _url, config: any) => ({
      data: { listGoods: config.params.offset ? [full[0]] : full },
    }));
    const goods = await client().listGoodsPrices();
    expect(calls.map((call: any) => [call.url, call.body.params])).toEqual([
      [`${WB_CATEGORY_HOSTS.prices}${WB_PATHS.goodsPrices}`, { limit: 1000, offset: 0 }],
      [`${WB_CATEGORY_HOSTS.prices}${WB_PATHS.goodsPrices}`, { limit: 1000, offset: 1000 }],
    ]);
    expect(goods).toHaveLength(WB_PRICES_LIMIT + 1);
  });

  it('маппер: общая цена размеров, разные цены — null и mixedSizes', () => {
    expect(
      mapGoodsPrices({
        data: {
          listGoods: [
            { nmID: 1, vendorCode: 'A', sizes: [{ price: 500 }, { price: 500 }], discount: 30 },
            { nmID: 2, vendorCode: 'B', sizes: [{ price: 500 }, { price: 700 }], discount: 0 },
            { nmID: 3, vendorCode: '', sizes: [] },
          ],
        },
      }),
    ).toEqual({
      goods: [
        { nmId: '1', vendorCode: 'A', price: 500, discount: 30, mixedSizes: false },
        { nmId: '2', vendorCode: 'B', price: null, discount: 0, mixedSizes: true },
      ],
      count: 3,
    });
  });
});

function ozonWriter(opts: { enabled?: boolean } = {}) {
  const client = {
    getPrices: vi.fn(async (skus: readonly string[]) =>
      skus.map((sku) => ({ offerId: sku, price: 100 })),
    ),
    updatePrices: vi.fn(async (items: Array<{ offerId: string }>) =>
      items.map((item) => ({
        offerId: item.offerId,
        updated: item.offerId !== 'BAD',
        message: 'x',
      })),
    ),
  };
  const service = new OzonPriceWriteService(
    { priceWriteEnabled: opts.enabled ?? true } as never,
    { forCredentials: () => client } as never,
    { credentialsOf: async () => ({ clientId: '1', apiKey: 'k' }) } as never,
  );
  return { service, client };
}

describe('OzonPriceWriteService', () => {
  it('текущие цены по артикулам', async () => {
    const { service, client } = ozonWriter();
    expect(await service.currentPrices('1', ['A'])).toEqual(new Map([['A', { price: 100 }]]));
    expect(client.getPrices).toHaveBeenCalledWith(['A']);
  });

  it('PRICE_WRITE_ENABLED=false — ни одного запроса', async () => {
    const { service, client } = ozonWriter({ enabled: false });
    expect(await service.writePrices('1', [{ sku: 'A', price: 100 }])).toEqual({
      written: 0,
      errors: [],
      skipped: [],
      skipReason: 'write-disabled',
    });
    expect(client.updatePrices).not.toHaveBeenCalled();
  });

  it.each([0, -5, 9.9])('цена %o — отмена целиком до HTTP', async (price) => {
    const { service, client } = ozonWriter();
    await expect(service.writePrices('1', [{ sku: 'A', price }])).rejects.toThrow(
      /отменена целиком/,
    );
    expect(client.updatePrices).not.toHaveBeenCalled();
  });

  it('батчи по 1000, отказ по позиции — в ошибках, сбой батча не останавливает следующий', async () => {
    const { service, client } = ozonWriter();
    client.updatePrices.mockImplementationOnce(async () => {
      throw new Error('503');
    });
    const updates = Array.from({ length: OZON_PRICES_BATCH + 2 }, (_, i) => ({
      sku: i === OZON_PRICES_BATCH ? 'BAD' : `S${i}`,
      price: 100,
    }));
    const result = await service.writePrices('1', updates);
    expect(client.updatePrices).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      written: 1,
      errors: [
        { batch: 1, message: '503' },
        { batch: 2, message: 'BAD: x' },
      ],
      skipped: [],
    });
  });
});

const GOODS: IWbGoodsPrice[] = [
  { nmId: '1', vendorCode: 'A', price: 1000, discount: 20, mixedSizes: false },
  { nmId: '2', vendorCode: 'B', price: null, discount: 0, mixedSizes: true },
];

function wbWriter(opts: { enabled?: boolean; prices?: () => Promise<IWbGoodsPrice[]> } = {}) {
  const client = {
    listGoodsPrices: vi.fn(opts.prices ?? (async () => GOODS)),
    uploadPrices: vi.fn(async (): Promise<void> => undefined),
  };
  const service = new WbPriceWriteService(
    { priceWriteEnabled: opts.enabled ?? true } as never,
    { forToken: () => client } as never,
    { credentialsOf: async () => ({ token: 't' }) } as never,
  );
  return { service, client };
}

const noAccess = async (): Promise<IWbGoodsPrice[]> => {
  throw new WbAuthError('scope not allowed', 401);
};

describe('WbPriceWriteService', () => {
  it('текущие цены — базовая и скидка продавца, только запрошенные артикулы', async () => {
    const { service } = wbWriter();
    expect(await service.currentPrices('1', ['A', 'C'])).toEqual(
      new Map([['A', { price: 1000, discount: 20 }]]),
    );
  });

  it('нет права «Цены и скидки»: чтение — понятный текст, запись — no-access без POST', async () => {
    const { service, client } = wbWriter({ prices: noAccess });
    const read = service.currentPrices('1', ['A']);
    await expect(read).rejects.toBeInstanceOf(WbPricesAccessError);
    await expect(read).rejects.toThrow(WB_PRICES_NO_ACCESS_TEXT);
    expect(WB_PRICES_NO_ACCESS_TEXT).toContain('«Цены и скидки»');

    expect(await service.writePrices('1', [{ sku: 'A', price: 900 }])).toEqual({
      written: 0,
      errors: [],
      skipped: [],
      skipReason: 'no-access',
    });
    expect(client.uploadPrices).not.toHaveBeenCalled();
  });

  it('не тот тип токена — свой текст WbAuthError, не «нет права»', async () => {
    const { service } = wbWriter({
      prices: async () => {
        throw new WbAuthError('token does not satisfy additional requirements', 403);
      },
    });
    const read = service.currentPrices('1', ['A']);
    await expect(read).rejects.toBeInstanceOf(WbAuthError);
    await expect(read).rejects.not.toBeInstanceOf(WbPricesAccessError);
  });

  it('PRICE_WRITE_ENABLED=false — ни одного запроса', async () => {
    const { service, client } = wbWriter({ enabled: false });
    expect((await service.writePrices('1', [{ sku: 'A', price: 1 }])).skipReason).toBe(
      'write-disabled',
    );
    expect(client.listGoodsPrices).not.toHaveBeenCalled();
    expect(client.uploadPrices).not.toHaveBeenCalled();
  });

  it('цена 0 — отмена целиком до HTTP', async () => {
    const { service, client } = wbWriter();
    await expect(service.writePrices('1', [{ sku: 'A', price: 0 }])).rejects.toThrow(
      /отменена целиком/,
    );
    expect(client.listGoodsPrices).not.toHaveBeenCalled();
  });

  it('разные цены размеров и нет товара — пропуск, остальное одним POST', async () => {
    const { service, client } = wbWriter();
    const result = await service.writePrices('1', [
      { sku: 'A', price: 1200 },
      { sku: 'B', price: 500 },
      { sku: 'C', price: 500 },
    ]);
    expect(client.uploadPrices).toHaveBeenCalledWith([{ nmId: '1', price: 1200 }]);
    expect(result).toEqual({
      written: 1,
      errors: [],
      skipped: [
        { sku: 'B', reason: WB_PRICE_SKIP_REASON.mixedSizes },
        { sku: 'C', reason: WB_PRICE_SKIP_REASON.notFound },
      ],
    });
  });

  it('сбой POST — в ошибках батча, не повторяется', async () => {
    const { service, client } = wbWriter();
    client.uploadPrices.mockRejectedValueOnce(new Error('503'));
    const result = await service.writePrices('1', [{ sku: 'A', price: 1200 }]);
    expect(client.uploadPrices).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ written: 0, errors: [{ batch: 1, message: '503' }] });
  });

  it('wbPriceWrites — чистое правило отбора', () => {
    expect(wbPriceWrites(GOODS, [{ sku: 'A', price: 5 }])).toEqual({
      writes: [{ sku: 'A', nmId: '1', price: 5 }],
      skipped: [],
    });
  });
});

describe('priceWrite в адаптерах Ozon и WB', () => {
  const REF = { telegramUserId: '7' } as never;
  const none = {} as never;

  it('делегация к сервисам цен; нет ключа — отказ реестра', async () => {
    const prices = {
      currentPrices: vi.fn(async () => new Map([['A', { price: 1 }]])),
      writePrices: vi.fn(async () => ({ written: 1, errors: [], skipped: [] })),
    };
    const ozon = new OzonMarketplaceAdapter(none, none, none, none, none, none, prices as never);
    const wb = new WbMarketplaceAdapter(none, none, none, none, none, none, prices as never);
    for (const adapter of [ozon, wb]) {
      expect(await adapter.priceWrite.currentPrices(REF, ['A'])).toEqual(
        new Map([['A', { price: 1 }]]),
      );
      expect((await adapter.priceWrite.writePrices(REF, [{ sku: 'A', price: 2 }])).written).toBe(1);
    }
    expect(prices.currentPrices).toHaveBeenCalledWith('7', ['A']);
    expect(prices.writePrices).toHaveBeenCalledWith('7', [{ sku: 'A', price: 2 }]);

    prices.currentPrices.mockRejectedValueOnce(new OzonNotConnectedError('7'));
    await expect(ozon.priceWrite.currentPrices(REF, ['A'])).rejects.toBeInstanceOf(
      MarketplaceNotConnectedError,
    );
    prices.writePrices.mockRejectedValueOnce(new WbNotConnectedError('7'));
    await expect(wb.priceWrite.writePrices(REF, [])).rejects.toBeInstanceOf(
      MarketplaceNotConnectedError,
    );
  });
});
