import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { YandexApiClient } from '../../src/modules/yandex/yandex-api.client';
import { AppConfigService } from '../../src/config/app-config.service';
import {
  API_VERSIONS,
  PAGE_LIMITS,
  ordersPath,
  returnsPath,
  tariffsCalculatePath,
} from '../../src/modules/yandex/yandex-api.paths';
import {
  YandexAuthError,
  YandexBadRequestError,
  YandexNetworkError,
  YandexNotFoundError,
  YandexRateLimitError,
  YandexServerError,
  toYandexApiError,
} from '../../src/modules/yandex/yandex-api.errors';

const BASE_URL = 'https://api.partner.market.yandex.ru';

/** Перехватывает axios.create и записывает все исходящие запросы. */
function stubAxios() {
  const calls: Array<{
    headers: Record<string, string>;
    baseURL: string;
    path: string;
    params: Record<string, unknown>;
    /** Тело запроса — только у POST; GET его не несёт. */
    body?: unknown;
  }> = [];
  let respond: () => Promise<unknown> = async () => ({ data: {} });
  let onError: (error: unknown) => unknown = (e) => {
    throw e;
  };

  const record = async (call: (typeof calls)[number]) => {
    calls.push(call);
    try {
      return await respond();
    } catch (raw) {
      // Повторяем поведение axios: ошибку пропускаем через интерцептор.
      return await Promise.resolve(onError(raw)).then(
        (v) => v,
        (e) => {
          throw e;
        },
      );
    }
  };

  vi.spyOn(axios, 'create').mockImplementation((config: any) => {
    const instance = {
      interceptors: {
        response: {
          use: (_ok: unknown, err: (e: unknown) => unknown) => {
            onError = err;
          },
        },
      },
      get: async (path: string, opts: { params: Record<string, unknown> }) =>
        record({
          headers: config.headers,
          baseURL: config.baseURL,
          path,
          params: opts?.params ?? {},
        }),
      post: async (path: string, body: unknown, opts: { params: Record<string, unknown> }) =>
        record({
          headers: config.headers,
          baseURL: config.baseURL,
          path,
          params: opts?.params ?? {},
          body,
        }),
    };
    return instance as never;
  });

  return {
    calls,
    setResponse(data: unknown) {
      respond = async () => ({ data });
    },
    /** Очередь ответов для методов с батчами: по одному на запрос, последний — по умолчанию. */
    setResponses(...queue: unknown[]) {
      respond = async () => ({ data: queue.length > 1 ? queue.shift() : queue[0] });
    },
    setFailure(status: number | undefined, payload?: unknown, message = 'boom') {
      respond = async () => {
        const error: any = new Error(message);
        error.config = { url: '/x' };
        if (status) error.response = { status, data: payload };
        throw error;
      };
    },
  };
}

describe('YandexClientFactory', () => {
  let axiosStub: ReturnType<typeof stubAxios>;

  beforeEach(() => {
    axiosStub = stubAxios();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function buildFactory() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        YandexClientFactory,
        { provide: AppConfigService, useValue: { yandexMarketBaseUrl: BASE_URL } },
      ],
    }).compile();
    return moduleRef.get(YandexClientFactory);
  }

  const creds = (n: number) => ({
    token: `ACMA:token-${n}`,
    campaignId: `1000${n}`,
    businessId: `2000${n}`,
  });

  it('массивы уходят повторяющимся параметром, а НЕ status[]=', async () => {
    // Главный тест этого файла по цене ошибки. Axios по умолчанию сериализует
    // массив как `status[]=DELIVERED`, а Partner API такой параметр молча
    // игнорирует и отдаёт заказы во ВСЕХ статусах. Проверено на боевом магазине:
    // с квадратными скобками за июль приходило 946 заказов вместо 389, и первая
    // страница не содержала ни одного нужного. Отчёты не врали лишь потому, что
    // matchesReport фильтрует ответ повторно у нас.
    const factory = await buildFactory();
    factory.forTenant(creds(1));

    const config = (
      axios.create as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }
    ).mock.calls[0][0];

    expect(config.paramsSerializer).toEqual({ indexes: null });

    // И то же самое поведением, а не только формой настройки: строка запроса
    // должна получиться без скобок.
    const uri = axios.getUri({
      url: '/orders',
      params: { status: ['DELIVERED', 'CANCELLED'] },
      paramsSerializer: config.paramsSerializer as never,
    });

    expect(uri).toBe('/orders?status=DELIVERED&status=CANCELLED');
    expect(uri).not.toContain('%5B');
  });

  it('отдаёт клиент на КАЖДЫЙ вызов, а не общий экземпляр', async () => {
    // Общий клиент с изменяемым заголовком означал бы, что при двух
    // параллельных отчётах запрос одного продавца уйдёт с токеном другого.
    const factory = await buildFactory();
    const a = factory.forTenant(creds(1));
    const b = factory.forTenant(creds(1));

    expect(a).toBeInstanceOf(YandexApiClient);
    expect(a).not.toBe(b);
  });

  it('креды одного продавца НЕ утекают в запрос за другого', async () => {
    const factory = await buildFactory();
    const first = factory.forTenant(creds(1));
    const second = factory.forTenant(creds(2));
    axiosStub.setResponse({ orders: [] });

    // Запросы вперемешку — как при двух параллельных отчётах.
    await first.getOrders();
    await second.getOrders();
    await first.getOrders();

    const tokens = axiosStub.calls.map((c) => c.headers['Api-Key']);
    const paths = axiosStub.calls.map((c) => c.path);

    expect(tokens).toEqual(['ACMA:token-1', 'ACMA:token-2', 'ACMA:token-1']);
    expect(paths).toEqual([ordersPath('10001'), ordersPath('10002'), ordersPath('10001')]);
  });

  it('падает внятно, если кред не заполнен', async () => {
    // Пустой токен ушёл бы в заголовок, Яндекс ответил бы 401, и в логах
    // осталось бы «неверный токен» вместо «токена нет вообще».
    const factory = await buildFactory();

    expect(() => factory.forTenant({ ...creds(1), token: '' })).toThrow(/token/);
    expect(() => factory.forTenant({ ...creds(1), campaignId: undefined as never })).toThrow(
      /campaignId/,
    );
    expect(() => factory.forStore(null as never)).toThrow();
  });

  it('forStore перекладывает snake_case поля документа', async () => {
    const factory = await buildFactory();
    const client = factory.forStore({
      token: 'ACMA:x',
      campaign_id: '777',
      business_id: '888',
    } as never);

    expect(client.campaignId).toBe('777');
    expect(client.businessId).toBe('888');
  });
});

describe('YandexApiClient: формирование запроса', () => {
  let axiosStub: ReturnType<typeof stubAxios>;

  beforeEach(() => {
    axiosStub = stubAxios();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // sleep подменён: клиент повторяет 420/5xx/сеть с паузами (TASK-020), и без
  // подмены эти тесты ждали бы настоящие секунды.
  const client = () =>
    new YandexApiClient(
      { token: 'ACMA:secret', campaignId: '12345', businessId: '67890' },
      BASE_URL,
      { sleep: async () => undefined },
    );

  it('авторизуется заголовком Api-Key, а не Authorization: Bearer', async () => {
    // Bearer ставил и прежний HttpClient, и сгенерированный OpenAPI-клиент —
    // Partner API его не понимает.
    axiosStub.setResponse({ orders: [] });
    await client().getOrders();

    expect(axiosStub.calls[0].headers['Api-Key']).toBe('ACMA:secret');
    expect(axiosStub.calls[0].headers.Authorization).toBeUndefined();
  });

  it('все пути содержат явную версию', async () => {
    axiosStub.setResponse({ orders: [], returns: [], campaigns: [] });
    const c = client();
    await c.getOrders();
    await c.getReturns();
    await c.getCampaigns();

    for (const call of axiosStub.calls) {
      expect(call.path).toMatch(/^\/v\d+\//);
    }
    expect(axiosStub.calls[0].path).toContain(`/${API_VERSIONS.orders}/`);
    expect(axiosStub.calls[1].path).toContain(`/${API_VERSIONS.returns}/`);
  });

  it('версии зафиксированы явно, а не «последняя по умолчанию»', () => {
    expect(ordersPath('1')).toBe('/v2/campaigns/1/orders');
    expect(returnsPath('1')).toBe('/v2/campaigns/1/returns');
  });

  it('пагинация только через pageToken — page и pageSize deprecated', async () => {
    axiosStub.setResponse({ orders: [], paging: { nextPageToken: 'next' } });
    const result = await client().getOrders({ pageToken: 'cur' });

    expect(axiosStub.calls[0].params.pageToken).toBe('cur');
    expect(axiosStub.calls[0].params).not.toHaveProperty('page');
    expect(axiosStub.calls[0].params).not.toHaveProperty('pageSize');
    expect(result.nextPageToken).toBe('next');
  });

  it('limit не превышает максимум метода', async () => {
    axiosStub.setResponse({ orders: [] });
    await client().getOrders({ limit: 500 });
    await client().getReturns({ limit: 500 });

    expect(axiosStub.calls[0].params.limit).toBe(PAGE_LIMITS.orders.max);
    expect(axiosStub.calls[1].params.limit).toBe(PAGE_LIMITS.returns.max);
    expect(PAGE_LIMITS.orders.max).toBeLessThan(PAGE_LIMITS.returns.max);
  });

  it('пустые параметры не уходят в строку запроса', async () => {
    axiosStub.setResponse({ orders: [] });
    await client().getOrders();

    expect(axiosStub.calls[0].params).not.toHaveProperty('status');
    expect(axiosStub.calls[0].params).not.toHaveProperty('pageToken');
  });

  it('пустой ответ не роняет разбор', async () => {
    axiosStub.setResponse({});
    const result = await client().getOrders();
    expect(result).toEqual({ items: [], nextPageToken: undefined });
  });

  it('401 доходит до вызывающего как доменная ошибка, а не как AxiosError', async () => {
    // Именно ради этого в клиенте стоит интерцептор: наружу не должен
    // просачиваться axios со своим config, в котором лежит заголовок с токеном.
    axiosStub.setFailure(401, { errors: [{ code: 'UNAUTHORIZED', message: 'bad token' }] });

    await expect(client().getOrders()).rejects.toBeInstanceOf(YandexAuthError);
  });

  it('ошибка клиента несёт код ответа и не содержит токен', async () => {
    axiosStub.setFailure(420, { errors: [{ message: 'rate limit' }] });

    const error = await client()
      .getOrders()
      .catch((e) => e);

    expect(error).toBeInstanceOf(YandexRateLimitError);
    expect(error.status).toBe(420);
    expect(error.retryable).toBe(true);
    expect(JSON.stringify(error.message)).not.toContain('ACMA:secret');
  });

  it('обрыв связи превращается в сетевую ошибку', async () => {
    axiosStub.setFailure(undefined, undefined, 'socket hang up');

    await expect(client().getReturns()).rejects.toBeInstanceOf(YandexNetworkError);
  });
});

describe('YandexApiClient: логистика каталога (getOfferMappings)', () => {
  let axiosStub: ReturnType<typeof stubAxios>;

  beforeEach(() => {
    axiosStub = stubAxios();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const client = () =>
    new YandexApiClient(
      { token: 'ACMA:secret', campaignId: '12345', businessId: '67890' },
      BASE_URL,
      { sleep: async () => undefined },
    );

  it('фильтр offerIds уходит в теле, а params ПУСТЫЕ — без limit и page_token', async () => {
    // По спеке offerIds взаимоисключим с пагинацией: запрос с обоими — 400.
    // loadCatalogOfferIds шлёт limit/page_token, и скопировать это сюда легко.
    axiosStub.setResponse({ result: { offerMappings: [] } });
    await client().getOfferMappings(['A-1', 'B-2']);

    expect(axiosStub.calls).toHaveLength(1);
    expect(axiosStub.calls[0].path).toBe('/v2/businesses/67890/offer-mappings');
    expect(axiosStub.calls[0].body).toEqual({ offerIds: ['A-1', 'B-2'] });
    expect(axiosStub.calls[0].params).toEqual({});
  });

  it('батчи по 100 артикулов — НЕ по 200 из спеки, дубли схлопываются', async () => {
    // Спека обещает до 200 offerIds, но боевой отвечает
    // «400: offerIds size must be between 1 and 100 (rejected size: 200)» —
    // проверено 04-08-2026. Лимит фильтра ≠ лимиту страницы.
    axiosStub.setResponse({ result: { offerMappings: [] } });
    const ids = Array.from({ length: 250 }, (_, i) => `SKU-${i}`);
    await client().getOfferMappings([...ids, 'SKU-0', 'SKU-1']);

    expect(axiosStub.calls).toHaveLength(3);
    expect((axiosStub.calls[0].body as { offerIds: string[] }).offerIds).toHaveLength(100);
    expect((axiosStub.calls[1].body as { offerIds: string[] }).offerIds).toHaveLength(100);
    expect((axiosStub.calls[2].body as { offerIds: string[] }).offerIds).toHaveLength(50);
  });

  it('категория берётся из offer с фолбэком на mapping', async () => {
    // marketCategoryId живёт в ДВУХ местах ответа, и у части товаров заполнено
    // только одно: offer-поле документировано как «может отсутствовать, если
    // Маркет ещё не определил категорию».
    axiosStub.setResponse({
      result: {
        offerMappings: [
          {
            offer: {
              offerId: 'A-1',
              marketCategoryId: 111,
              weightDimensions: { length: 10, width: 8, height: 5, weight: 0.4 },
            },
            mapping: { marketCategoryId: 999 },
          },
          { offer: { offerId: 'B-2' }, mapping: { marketCategoryId: 222 } },
          { mapping: { marketCategoryId: 333 } }, // без артикула — пропускается
        ],
      },
    });

    const map = await client().getOfferMappings(['A-1', 'B-2']);

    expect(map.get('A-1')?.marketCategoryId).toBe(111);
    expect(map.get('A-1')?.weightDimensions).toEqual({
      length: 10,
      width: 8,
      height: 5,
      weight: 0.4,
    });
    expect(map.get('B-2')?.marketCategoryId).toBe(222);
    expect(map.get('B-2')?.weightDimensions).toBeUndefined();
    expect(map.size).toBe(2);
  });
});

describe('YandexApiClient: калькулятор тарифов (calculateTariffs)', () => {
  let axiosStub: ReturnType<typeof stubAxios>;

  beforeEach(() => {
    axiosStub = stubAxios();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const client = () =>
    new YandexApiClient(
      { token: 'ACMA:secret', campaignId: '12345', businessId: '67890' },
      BASE_URL,
      { sleep: async () => undefined },
    );

  const offer = (n: number) => ({
    categoryId: 100 + n,
    price: 1000 + n,
    length: 11,
    width: 11,
    height: 11,
    weight: 0.3,
  });

  it('campaignId уходит в ТЕЛЕ и числом, sellingProgram не отправляется', async () => {
    // По спеке campaignId — int64, а sellingProgram взаимоисключим с ним:
    // вместе — ошибка. Строковый campaignId из кредов должен стать числом.
    axiosStub.setResponse({ result: { offers: [] } });
    await client().calculateTariffs([offer(1)]);

    expect(axiosStub.calls[0].path).toBe(tariffsCalculatePath());
    expect(axiosStub.calls[0].path).toBe('/v2/tariffs/calculate');
    expect(axiosStub.calls[0].params).toEqual({});

    const body = axiosStub.calls[0].body as {
      parameters: Record<string, unknown>;
      offers: unknown[];
    };
    expect(body.parameters.campaignId).toBe(12345);
    expect(body.parameters).not.toHaveProperty('sellingProgram');
    expect(body.parameters).not.toHaveProperty('frequency');
    expect(body.offers).toEqual([offer(1)]);
  });

  it('frequency уходит только когда передан', async () => {
    axiosStub.setResponse({ result: { offers: [] } });
    await client().calculateTariffs([offer(1)], { frequency: 'WEEKLY' });

    const body = axiosStub.calls[0].body as { parameters: Record<string, unknown> };
    expect(body.parameters.frequency).toBe('WEEKLY');
  });

  it('больше 200 товаров режется на батчи с сохранением порядка', async () => {
    // Порядок — единственный способ сопоставить расчёт с товаром.
    const offers = Array.from({ length: 250 }, (_, i) => offer(i));
    axiosStub.setResponses(
      {
        result: {
          offers: offers.slice(0, 200).map((o) => ({
            offer: o,
            tariffs: [{ type: 'FEE', amount: o.price * 0.1 }],
          })),
        },
      },
      {
        result: {
          offers: offers.slice(200).map((o) => ({
            offer: o,
            tariffs: [{ type: 'FEE', amount: o.price * 0.1 }],
          })),
        },
      },
    );

    const result = await client().calculateTariffs(offers);

    expect(axiosStub.calls).toHaveLength(2);
    expect((axiosStub.calls[0].body as { offers: unknown[] }).offers).toHaveLength(200);
    expect((axiosStub.calls[1].body as { offers: unknown[] }).offers).toHaveLength(50);
    expect(result).toHaveLength(250);
    expect(result[0].offer.categoryId).toBe(100);
    expect(result[249].offer.categoryId).toBe(349);
    expect(result[249].tariffs).toEqual([{ type: 'FEE', amount: 124.9 }]);
  });

  it('эхо без offer восстанавливается по позиции, пустые tariffs — пустым массивом', async () => {
    axiosStub.setResponse({ result: { offers: [{}] } });
    const result = await client().calculateTariffs([offer(7)]);

    expect(result).toHaveLength(1);
    expect(result[0].offer).toEqual(offer(7));
    expect(result[0].tariffs).toEqual([]);
  });
});

describe('Ошибки Partner API', () => {
  it.each([
    [401, YandexAuthError],
    [403, YandexAuthError],
    [404, YandexNotFoundError],
    [420, YandexRateLimitError],
    [429, YandexRateLimitError],
    [400, YandexBadRequestError],
    [500, YandexServerError],
    [503, YandexServerError],
  ])('%i превращается в доменную ошибку', (status, type) => {
    const error = toYandexApiError(status as number, undefined, 'boom');
    expect(error).toBeInstanceOf(type);
    expect(error.status).toBe(status);
  });

  it('отсутствие ответа — сетевая ошибка со статусом 0', () => {
    const error = toYandexApiError(undefined, undefined, 'timeout');
    expect(error).toBeInstanceOf(YandexNetworkError);
    expect(error.status).toBe(0);
  });

  it('код ответа СОХРАНЯЕТСЯ — по строке его было не достать', () => {
    // Прежний клиент сворачивал ответ в текст вида
    // «HTTP Error 401: Unauthorized - {...}», и вызывающий код не мог отличить
    // протухший токен от лежащего Яндекса иначе как регуляркой.
    expect(toYandexApiError(420, undefined, 'x').status).toBe(420);
  });

  it('сообщение Яндекса из errors[] попадает в ошибку', () => {
    const error = toYandexApiError(
      400,
      { errors: [{ code: 'BAD_REQUEST', message: 'limit is too big' }] },
      'fallback',
    );
    expect(error.message).toContain('BAD_REQUEST');
    expect(error.message).toContain('limit is too big');
  });

  it('повторять имеет смысл только лимит, 5xx и сеть', () => {
    expect(toYandexApiError(420, undefined, 'x').retryable).toBe(true);
    expect(toYandexApiError(500, undefined, 'x').retryable).toBe(true);
    expect(toYandexApiError(undefined, undefined, 'x').retryable).toBe(true);
    expect(toYandexApiError(401, undefined, 'x').retryable).toBe(false);
    expect(toYandexApiError(400, undefined, 'x').retryable).toBe(false);
  });

  it('текст для пользователя не содержит внутренностей ответа', () => {
    const error = toYandexApiError(401, { errors: [{ message: 'ACMA:secret rejected' }] }, 'x');
    expect(error.userMessage).not.toContain('ACMA:secret');
    expect(error.userMessage).toContain('токен');
  });

  it('ошибка авторизации называет нужный доступ — с правом записи', () => {
    // Тест закреплял read-only. После TASK-035 это неверно: обновление
    // остатков — операция записи, и с read-only токеном вернётся 403.
    const text = toYandexApiError(403, undefined, 'x').userMessage;
    expect(text).toContain('Обработка заказов и учёт товаров');
    expect(text).not.toContain('read-only');
  });
});
