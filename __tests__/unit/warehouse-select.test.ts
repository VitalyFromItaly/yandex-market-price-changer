import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

import { YandexApiClient } from '../../src/modules/yandex/yandex-api.client';
import { WAREHOUSE_PROBE_LIMIT } from '../../src/modules/yandex/yandex-api.paths';

const BASE_URL = 'https://api.partner.market.yandex.ru';
const CREDENTIALS = { token: 't', campaignId: '148655119', businessId: '164225008' };

/** Склад Маркета: на FBS в ответе бывает склад возвратов, на FBY — фулфилмент. */
const MARKET_WAREHOUSE = 147;
/** Собственный склад продавца — единственный, куда можно писать остатки. */
const OWN_WAREHOUSE = 1826207;

/**
 * Заглушка axios с раздельными ответами на GET и POST: `getWarehouseId` теперь
 * задаёт два вопроса сразу — «где лежит товар кампании» (POST offers/stocks) и
 * «какие склады МОИ» (GET businesses/{id}/warehouses).
 */
function stubAxios(options: {
  stocksWarehouses: Array<{ warehouseId?: number }>;
  /** Собственные склады бизнеса. Пустой массив — «своих нет». */
  ownWarehouses?: number[];
  /** Склады, приходящие внутри групп: в общий список они не дублируются. */
  ownGroupWarehouses?: number[];
  ownFails?: boolean;
}) {
  const calls: Array<{ method: 'get' | 'post'; path: string; params: Record<string, unknown> }> =
    [];

  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: { response: { use: () => undefined } },
        get: async (path: string, opts: { params?: Record<string, unknown> }) => {
          calls.push({ method: 'get', path, params: opts?.params ?? {} });
          if (options.ownFails) throw new Error('ECONNRESET');
          return {
            data: {
              result: {
                warehouses: (options.ownWarehouses ?? [OWN_WAREHOUSE]).map((id) => ({
                  id,
                  name: `Склад ${id}`,
                })),
                warehouseGroups: (options.ownGroupWarehouses ?? []).map((id) => ({
                  name: 'SBrand',
                  warehouses: [{ id, name: `Склад ${id}` }],
                })),
              },
            },
          };
        },
        post: async (path: string, _body: unknown, opts: { params?: Record<string, unknown> }) => {
          calls.push({ method: 'post', path, params: opts?.params ?? {} });
          return { data: { result: { warehouses: options.stocksWarehouses } } };
        },
      }) as never,
  );

  return { calls };
}

/**
 * Клиент строится ПОСЛЕ подмены axios: `axios.create` вызывается в конструкторе,
 * и заглушка, поставленная позже, до экземпляра уже не доедет.
 */
function clientWith(options: Parameters<typeof stubAxios>[0]) {
  const stub = stubAxios(options);
  return { client: new YandexApiClient(CREDENTIALS, BASE_URL), ...stub };
}

/**
 * Выбор склада ДЛЯ ЗАПИСИ остатков.
 *
 * Раньше брался первый склад из ответа кампании — то есть выбор зависел от
 * порядка, в котором Яндекс перечислит склады. Среди них бывает чужой: на FBY
 * это склад Маркета (147 «Ростов-на-Дону-1» у живого продавца), на FBS —
 * склад возвратов Маркета, куда попал невыкупленный заказ. Записав туда, мы бы
 * отправили остатки всего магазина на чужой склад, и откатить это нечем.
 */
describe('getWarehouseId: склад записи — только собственный', () => {
  afterEach(() => vi.restoreAllMocks());

  it('берёт свой склад, даже если чужой стоит в ответе первым', async () => {
    const { client } = clientWith({
      stocksWarehouses: [{ warehouseId: MARKET_WAREHOUSE }, { warehouseId: OWN_WAREHOUSE }],
    });

    expect(await client.getWarehouseId()).toBe(OWN_WAREHOUSE);
  });

  it('спрашивает не один склад, иначе чужой вытеснил бы свой из ответа', async () => {
    // При limit: 1 второй склад просто не приехал бы, и сверять было бы не с чем.
    const { client, calls } = clientWith({
      stocksWarehouses: [{ warehouseId: OWN_WAREHOUSE }],
    });
    await client.getWarehouseId();

    const stocks = calls.find((c) => c.method === 'post');
    expect(stocks?.params.limit).toBe(WAREHOUSE_PROBE_LIMIT);
    expect(WAREHOUSE_PROBE_LIMIT).toBeGreaterThan(1);
  });

  it('сверяется со СВОИМИ складами бизнеса, а не с догадкой', async () => {
    const { client, calls } = clientWith({
      stocksWarehouses: [{ warehouseId: OWN_WAREHOUSE }],
    });
    await client.getWarehouseId();

    expect(calls.some((c) => c.method === 'get' && c.path.includes('/warehouses'))).toBe(true);
  });

  it('в ответе только чужие склады — ошибка, а не «возьмём первый»', async () => {
    // Писать наугад хуже, чем не писать: Яндекс не сообщает, что применилось.
    const { client } = clientWith({ stocksWarehouses: [{ warehouseId: MARKET_WAREHOUSE }] });

    await expect(client.getWarehouseId()).rejects.toThrow(/чужие склады/);
  });

  it('список своих складов недоступен — тоже ошибка', async () => {
    const { client } = clientWith({
      stocksWarehouses: [{ warehouseId: OWN_WAREHOUSE }],
      ownFails: true,
    });

    await expect(client.getWarehouseId()).rejects.toThrow();
  });

  it('пустой ответ по складам кампании — прежняя понятная ошибка', async () => {
    const { client } = clientWith({ stocksWarehouses: [] });

    await expect(client.getWarehouseId()).rejects.toThrow(/не вернул warehouseId/);
  });

  it('склады из групп тоже считаются своими', async () => {
    // Склады, входящие в группу, приходят отдельным списком `warehouseGroups` и
    // в общий `warehouses` не дублируются — не учесть их значило бы объявить
    // собственный склад чужим и отказать в записи всему кабинету с группами.
    const { client } = clientWith({
      stocksWarehouses: [{ warehouseId: 1519714 }],
      ownWarehouses: [],
      ownGroupWarehouses: [1519714],
    });

    expect(await client.getWarehouseId()).toBe(1519714);
  });
});
