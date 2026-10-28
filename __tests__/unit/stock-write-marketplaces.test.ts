import { Logger } from '@nestjs/common';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IOzonWarehouse } from '../../src/modules/ozon/ozon.client';
import type { IWbCard, IWbWarehouse } from '../../src/modules/wb/wb.client';

import { stockWriteTargetOf } from '../../src/modules/marketplaces/stock-write';
import {
  OzonStockWriteService,
  ozonStockWriteTarget,
} from '../../src/modules/ozon/ozon-stock-write.service';
import {
  OZON_PATHS,
  OzonSellerClient,
  mapStocksWrite,
  mapWarehouses as mapOzonWarehouses,
} from '../../src/modules/ozon/ozon.client';
import {
  OzonNetworkError,
  OzonRateLimitError,
  OzonServerError,
} from '../../src/modules/ozon/ozon.errors';
import {
  WB_SKIP_REASON,
  WbStockWriteService,
  wbStockWriteTarget,
  wbStockWrites,
} from '../../src/modules/wb/wb-stock-write.service';
import {
  WB_CATEGORY_HOSTS,
  WbClient,
  mapWarehouses as mapWbWarehouses,
} from '../../src/modules/wb/wb.client';
import { WbNetworkError, WbRateLimitError, WbServerError } from '../../src/modules/wb/wb.errors';

/**
 * Запись остатков в Ozon и WB (TASK-175): без повторов, только единственный
 * FBS-склад продавца, `STOCK_WRITE_ENABLED=false` — ни одного запроса.
 */

/** Сбой axios: статус или обрыв связи. */
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
      const body = name === 'get' ? undefined : bodyOrConfig;
      calls.push({ method: name, url, body });
      try {
        return { data: await respond(name, url, body) };
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
        put: method('put'),
      }) as never,
  );
  return calls;
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('склад записи — ровно один FBS', () => {
  it('один FBS — ok; второй склад любого типа — several; один не FBS — none', () => {
    expect(stockWriteTargetOf([{ id: '1', name: 'Дом', fbs: true }])).toEqual({
      kind: 'ok',
      warehouse: { id: '1', name: 'Дом' },
    });
    expect(
      stockWriteTargetOf([
        { id: '1', name: 'Дом', fbs: true },
        { id: '2', name: 'DBS', fbs: false },
      ]),
    ).toEqual({ kind: 'several', names: ['Дом', 'DBS'] });
    expect(stockWriteTargetOf([{ id: '1', name: 'DBS', fbs: false }])).toEqual({ kind: 'none' });
    expect(stockWriteTargetOf([])).toEqual({ kind: 'none' });
  });

  it('Ozon: архивный не в счёт, незнакомый статус — писать некуда', () => {
    const wh = (id: string, status: string): IOzonWarehouse => ({
      id,
      name: `W${id}`,
      isRfbs: false,
      status,
    });
    expect(ozonStockWriteTarget([wh('1', 'created'), wh('2', 'disabled')]).kind).toBe('ok');
    expect(ozonStockWriteTarget([wh('1', 'created'), wh('2', 'blocked')]).kind).toBe('several');
    expect(ozonStockWriteTarget([wh('1', 'new')]).kind).toBe('none');
  });

  it('WB: FBS — только deliveryType 1, тип неизвестен — не пишется', () => {
    const wh = (id: string, deliveryType: number | null): IWbWarehouse => ({
      id,
      name: `W${id}`,
      deliveryType,
    });
    expect(wbStockWriteTarget([wh('1', 1)]).kind).toBe('ok');
    expect(wbStockWriteTarget([wh('1', 2)]).kind).toBe('none');
    expect(wbStockWriteTarget([wh('1', null)]).kind).toBe('none');
    expect(wbStockWriteTarget([wh('1', 1), wh('2', 1)]).kind).toBe('several');
  });

  it('мапперы складов: мусор отбрасывается, тип доставки WB читается', () => {
    expect(
      mapOzonWarehouses({
        result: [
          { warehouse_id: 22, name: 'Склад', is_rfbs: true, status: 'CREATED' },
          { name: 'без id' },
        ],
      }),
    ).toEqual([{ id: '22', name: 'Склад', isRfbs: true, status: 'created' }]);
    expect(
      mapWbWarehouses([
        { id: 5, name: 'FBS', deliveryType: 1 },
        { id: 6, name: 'X' },
      ]),
    ).toEqual([
      { id: '5', name: 'FBS', deliveryType: 1 },
      { id: '6', name: 'X', deliveryType: null },
    ]);
  });
});

describe('OzonSellerClient.updateStocks — запись без повторов', () => {
  const sleep = vi.fn(async () => undefined);
  const client = () =>
    new OzonSellerClient('https://ozon', { clientId: '1', apiKey: 'k' }, { sleep });

  it('тело запроса и построчный ответ', async () => {
    const calls = stubHttp(() => ({
      result: [
        { offer_id: 'A', updated: true, errors: [] },
        { offer_id: 'B', updated: false, errors: [{ code: 'NOT_FOUND', message: 'нет товара' }] },
      ],
    }));
    const rows = await client().updateStocks('77', [
      { offerId: 'A', stock: 3 },
      { offerId: 'B', stock: 0 },
    ]);
    expect(calls).toEqual([
      {
        method: 'post',
        url: OZON_PATHS.stocksWrite,
        body: {
          stocks: [
            { offer_id: 'A', stock: 3, warehouse_id: 77 },
            { offer_id: 'B', stock: 0, warehouse_id: 77 },
          ],
        },
      },
    ]);
    expect(rows).toEqual([
      { offerId: 'A', updated: true, message: undefined },
      { offerId: 'B', updated: false, message: 'нет товара' },
    ]);
  });

  it.each([
    [503, OzonServerError],
    [429, OzonRateLimitError],
    [undefined, OzonNetworkError],
  ])('%s — ровно один запрос, без паузы', async (status, errorClass) => {
    const calls = stubHttp((method, url) => {
      throw axiosFailure(method, url, status);
    });
    await expect(client().updateStocks('77', [{ offerId: 'A', stock: 1 }])).rejects.toBeInstanceOf(
      errorClass,
    );
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('без updated: true — не записано', () => {
    expect(mapStocksWrite({ result: [{ offer_id: 'A' }] })).toEqual([
      { offerId: 'A', updated: false, message: 'Ozon не подтвердил запись' },
    ]);
  });
});

describe('WbClient.updateSellerStocks — запись без повторов', () => {
  const sleep = vi.fn(async () => undefined);
  const client = () => new WbClient('token', { sleep });

  it('PUT на склад продавца, штрихкод в sku', async () => {
    const calls = stubHttp(() => undefined);
    await client().updateSellerStocks('9', [{ barcode: '460', amount: 2 }]);
    expect(calls).toEqual([
      {
        method: 'put',
        url: `${WB_CATEGORY_HOSTS.marketplace}/api/v3/stocks/9`,
        body: { stocks: [{ sku: '460', amount: 2 }] },
      },
    ]);
  });

  it.each([
    [503, WbServerError],
    [429, WbRateLimitError],
    [undefined, WbNetworkError],
  ])('%s — ровно один запрос, без паузы', async (status, errorClass) => {
    const calls = stubHttp((method, url) => {
      throw axiosFailure(method, url, status);
    });
    await expect(
      client().updateSellerStocks('9', [{ barcode: '460', amount: 2 }]),
    ).rejects.toBeInstanceOf(errorClass);
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('WB: артикул → штрихкод', () => {
  const card = (vendorCode: string, ...sizes: string[][]): IWbCard => ({
    nmID: vendorCode,
    vendorCode,
    sizes: sizes.map((barcodes, i) => ({ chrtID: String(i), barcodes })),
  });

  it('один штрихкод пишется, несколько размеров и без штрихкода — пропуск', () => {
    const result = wbStockWrites(
      [card('A', ['111']), card('B', ['221'], ['222']), card('C', [])],
      [
        { sku: 'A', count: 3 },
        { sku: 'B', count: 1 },
        { sku: 'C', count: 1 },
        { sku: 'D', count: 1 },
      ],
    );
    expect(result.writes).toEqual([{ sku: 'A', barcode: '111', amount: 3 }]);
    expect(result.skipped).toEqual([
      { sku: 'B', reason: WB_SKIP_REASON.severalSizes },
      { sku: 'C', reason: WB_SKIP_REASON.noBarcode },
      { sku: 'D', reason: WB_SKIP_REASON.noBarcode },
    ]);
  });
});

/** Сервис записи с клиентом-заглушкой: видно, ушёл ли хоть один запрос. */
function ozonWriter(opts: { enabled: boolean; warehouses?: IOzonWarehouse[] }) {
  const client = {
    listWarehouses: vi.fn(
      async () => opts.warehouses ?? [{ id: '77', name: 'Дом', isRfbs: false, status: 'created' }],
    ),
    updateStocks: vi.fn(async (_id: string, items: Array<{ offerId: string }>) =>
      items.map((item) => ({
        offerId: item.offerId,
        updated: item.offerId !== 'BAD',
        message: 'x',
      })),
    ),
  };
  const service = new OzonStockWriteService(
    { stockWriteEnabled: opts.enabled } as never,
    { forCredentials: () => client } as never,
    { credentialsOf: async () => ({ clientId: '1', apiKey: 'k' }) } as never,
  );
  return { service, client };
}

function wbWriter(opts: { enabled: boolean; warehouses?: IWbWarehouse[] }) {
  const client = {
    listWarehouses: vi.fn(
      async () => opts.warehouses ?? [{ id: '9', name: 'Дом', deliveryType: 1 }],
    ),
    listCards: vi.fn(async () => [
      { nmID: '1', vendorCode: 'A', sizes: [{ chrtID: '1', barcodes: ['111'] }] },
      {
        nmID: '2',
        vendorCode: 'B',
        sizes: [
          { chrtID: '1', barcodes: ['221'] },
          { chrtID: '2', barcodes: ['222'] },
        ],
      },
    ]),
    updateSellerStocks: vi.fn(async () => undefined),
  };
  const service = new WbStockWriteService(
    { stockWriteEnabled: opts.enabled } as never,
    { forToken: () => client } as never,
    { credentialsOf: async () => ({ token: 't' }) } as never,
  );
  return { service, client };
}

describe('OzonStockWriteService.writeStocks — барьеры внутри', () => {
  it('STOCK_WRITE_ENABLED=false — ни одного запроса', async () => {
    const { service, client } = ozonWriter({ enabled: false });
    const result = await service.writeStocks('1', '77', [{ sku: 'A', count: 1 }]);
    expect(result).toMatchObject({ written: 0, skipReason: 'write-disabled' });
    expect(client.listWarehouses).not.toHaveBeenCalled();
    expect(client.updateStocks).not.toHaveBeenCalled();
  });

  it('склад уже не единственный или другой — placement, без записи', async () => {
    const several = ozonWriter({
      enabled: true,
      warehouses: [
        { id: '77', name: 'Дом', isRfbs: false, status: 'created' },
        { id: '78', name: 'Второй', isRfbs: true, status: 'created' },
      ],
    });
    expect(
      (await several.service.writeStocks('1', '77', [{ sku: 'A', count: 1 }])).skipReason,
    ).toBe('placement');
    const other = ozonWriter({ enabled: true });
    expect((await other.service.writeStocks('1', '99', [{ sku: 'A', count: 1 }])).skipReason).toBe(
      'placement',
    );
    expect(several.client.updateStocks).not.toHaveBeenCalled();
    expect(other.client.updateStocks).not.toHaveBeenCalled();
  });

  it('отрицательное количество — отмена целиком до запросов', async () => {
    const { service, client } = ozonWriter({ enabled: true });
    await expect(service.writeStocks('1', '77', [{ sku: 'A', count: -1 }])).rejects.toThrow(
      /отменена целиком/,
    );
    expect(client.listWarehouses).not.toHaveBeenCalled();
  });

  it('пишет батчами, отказ Ozon по позиции — в ошибках', async () => {
    const { service, client } = ozonWriter({ enabled: true });
    const updates = Array.from({ length: 101 }, (_, i) => ({ sku: i ? `S${i}` : 'BAD', count: 1 }));
    const result = await service.writeStocks('1', '77', updates);
    expect(client.updateStocks).toHaveBeenCalledTimes(2);
    expect(result.written).toBe(100);
    expect(result.errors).toEqual([{ batch: 1, message: 'BAD: x' }]);
  });
});

describe('WbStockWriteService.writeStocks — барьеры внутри', () => {
  it('STOCK_WRITE_ENABLED=false — ни одного запроса', async () => {
    const { service, client } = wbWriter({ enabled: false });
    const result = await service.writeStocks('1', '9', [{ sku: 'A', count: 1 }]);
    expect(result).toMatchObject({ written: 0, skipReason: 'write-disabled' });
    expect(client.listWarehouses).not.toHaveBeenCalled();
    expect(client.updateSellerStocks).not.toHaveBeenCalled();
  });

  it('склад DBS — placement, без записи', async () => {
    const { service, client } = wbWriter({
      enabled: true,
      warehouses: [{ id: '9', name: 'DBS', deliveryType: 2 }],
    });
    expect((await service.writeStocks('1', '9', [{ sku: 'A', count: 1 }])).skipReason).toBe(
      'placement',
    );
    expect(client.updateSellerStocks).not.toHaveBeenCalled();
  });

  it('многоразмерная карточка не пишется, остальное — одним PUT', async () => {
    const { service, client } = wbWriter({ enabled: true });
    const result = await service.writeStocks('1', '9', [
      { sku: 'A', count: 4 },
      { sku: 'B', count: 2 },
    ]);
    expect(client.updateSellerStocks).toHaveBeenCalledWith('9', [{ barcode: '111', amount: 4 }]);
    expect(result).toEqual({
      written: 1,
      errors: [],
      skipped: [{ sku: 'B', reason: WB_SKIP_REASON.severalSizes }],
    });
  });

  it('склад записи для плана — с артикулами, которые запись пропустит; без записи', async () => {
    const { service, client } = wbWriter({ enabled: true });
    expect(await service.writeTarget('1')).toEqual({
      kind: 'ok',
      warehouse: { id: '9', name: 'Дом' },
      unwritable: [{ sku: 'B', reason: WB_SKIP_REASON.severalSizes }],
    });
    expect(client.updateSellerStocks).not.toHaveBeenCalled();
  });

  it('сбой PUT — в ошибках батча, не повторяется', async () => {
    const { service, client } = wbWriter({ enabled: true });
    client.updateSellerStocks.mockRejectedValueOnce(new Error('503'));
    const result = await service.writeStocks('1', '9', [{ sku: 'A', count: 4 }]);
    expect(client.updateSellerStocks).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ written: 0, errors: [{ batch: 1, message: '503' }] });
  });
});
