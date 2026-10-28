import { Logger } from '@nestjs/common';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionLogService } from '../../src/database/services/action-log.service';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { parseOzonCredentials } from '../../src/modules/ozon/ozon-connection.domain';
import {
  OZON_PATHS,
  OZON_TIMEOUT_MS,
  OzonSellerClient,
  mapRoles,
} from '../../src/modules/ozon/ozon.client';
import {
  OzonApiError,
  OzonAuthError,
  OzonNetworkError,
  OzonRequestError,
  OzonRateLimitError,
  OzonServerError,
  toOzonApiError,
} from '../../src/modules/ozon/ozon.errors';

const BASE_URL = 'https://api-seller.ozon.ru';
const CLIENT_ID = '1234567';
const API_KEY = 'aaaaaaaa-SECRET-bbbb-cccc-0123456789ab';

const ROLES = {
  roles: [{ name: 'Admin read only', methods: ['/v1/roles', '/v3/product/list'] }],
  expires_at: '2027-10-16T00:00:00Z',
};

/** Перехватывает axios.create и отвечает очередью — образец polza-client.test.ts. */
function stubAxios() {
  const created: Array<Record<string, any>> = [];
  const calls: Array<{ path: string; body?: unknown }> = [];
  let queue: Array<() => unknown> = [];
  let onError: (error: unknown) => unknown = (e) => {
    throw e;
  };

  vi.spyOn(axios, 'create').mockImplementation((config: any) => {
    created.push(config);
    return {
      interceptors: {
        response: { use: (_ok: unknown, err: (e: unknown) => unknown) => (onError = err) },
      },
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        const next = queue.length > 1 ? queue.shift() : queue[0];
        try {
          return { data: await next?.() };
        } catch (raw) {
          return onError(raw);
        }
      },
    } as never;
  });

  const failure =
    (status: number | undefined, data?: unknown, headers: Record<string, string> = {}) =>
    () => {
      const error: any = new Error(
        status ? `Request failed with status code ${status}` : 'timeout of 30000ms exceeded',
      );
      // config с заголовками — как у настоящего axios: в нём лежит Api-Key.
      error.config = {
        method: 'post',
        url: OZON_PATHS.roles,
        headers: { 'Client-Id': CLIENT_ID, 'Api-Key': API_KEY },
      };
      if (status) error.response = { status, data, headers };
      throw error;
    };

  return {
    created,
    calls,
    respond(...steps: Array<() => unknown>) {
      queue = steps;
    },
    ok: (data: unknown) => () => data,
    failure,
  };
}

describe('OzonSellerClient', () => {
  let stub: ReturnType<typeof stubAxios>;
  let logged: string[];
  const sleep = vi.fn().mockResolvedValue(undefined);
  const client = () =>
    new OzonSellerClient(BASE_URL, { clientId: CLIENT_ID, apiKey: API_KEY }, { sleep });

  beforeEach(() => {
    stub = stubAxios();
    logged = [];
    sleep.mockClear();
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('заголовки Client-Id и Api-Key, база из конфига, без прокси из env', async () => {
    stub.respond(stub.ok(ROLES));
    expect(await client().roles()).toEqual({
      roles: [{ name: 'Admin read only', methods: ['/v1/roles', '/v3/product/list'] }],
      expiresAt: '2027-10-16T00:00:00Z',
    });
    expect(stub.created[0]).toMatchObject({
      baseURL: BASE_URL,
      timeout: OZON_TIMEOUT_MS,
      proxy: false,
      headers: { 'Client-Id': CLIENT_ID, 'Api-Key': API_KEY },
    });
    expect(stub.calls).toEqual([{ path: '/v1/roles', body: {} }]);
  });

  it('склады — /v2/warehouse/list по курсору, limit 200', async () => {
    const wh = (id: number) => ({
      warehouse_id: id,
      name: `W${id}`,
      is_rfbs: false,
      status: 'created',
    });
    stub.respond(
      stub.ok({ warehouses: [wh(1)], cursor: 'c1', has_next: true }),
      stub.ok({ warehouses: [wh(2)], cursor: '', has_next: false }),
    );
    const warehouses = await client().listWarehouses();
    expect(warehouses.map((w) => w.id)).toEqual(['1', '2']);
    expect(stub.calls.map((c) => c.path)).toEqual(['/v2/warehouse/list', '/v2/warehouse/list']);
    expect(stub.calls.map((c) => c.body)).toEqual([
      { limit: 200, cursor: '' },
      { limit: 200, cursor: 'c1' },
    ]);
  });

  it('400 «obsolete» — без повторов, честный текст', async () => {
    stub.respond(stub.failure(400, { code: 9, message: 'obsolete method cannot be used' }));
    const error = await client()
      .listWarehouses()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OzonRequestError);
    expect((error as OzonRequestError).userMessage).toContain('Ozon отключил метод API');
    expect(stub.calls).toHaveLength(1);
  });

  it('401 — OzonAuthError сразу, без повторов', async () => {
    stub.respond(
      stub.failure(401, {
        code: 16,
        message: 'Invalid Api-Key, please check the key and try again',
      }),
    );
    const error = await client()
      .roles()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OzonAuthError);
    expect((error as OzonAuthError).code).toBe('16');
    expect((error as OzonAuthError).request).toBe('POST /v1/roles');
    expect(stub.calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('429 с Retry-After, 503 и обрыв связи повторяются, потом успех', async () => {
    stub.respond(
      stub.failure(429, { code: 8, message: 'rate limit' }, { 'retry-after': '2' }),
      stub.failure(503),
      stub.failure(undefined),
      stub.ok(ROLES),
    );
    expect((await client().roles()).roles).toHaveLength(1);
    expect(stub.calls).toHaveLength(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 2000, 4000]);
  });

  it('четыре сбоя подряд — ошибка наверх; Retry-After больше минуты не ждём', async () => {
    stub.respond(stub.failure(502));
    await expect(client().roles()).rejects.toBeInstanceOf(OzonServerError);
    expect(stub.calls).toHaveLength(4);

    stub.respond(stub.failure(429, {}, { 'retry-after': '120' }));
    await expect(client().roles()).rejects.toBeInstanceOf(OzonRateLimitError);
    expect(stub.calls).toHaveLength(5);
  });

  it('ключ не попадает ни в логи, ни в ошибку, ни в журнал ErrorReporter (source: ozon)', async () => {
    stub.respond(stub.failure(401, { code: 16, message: 'Invalid Api-Key' }));
    const error = (await client()
      .roles()
      .catch((e: unknown) => e)) as OzonApiError;

    const record = vi.fn().mockResolvedValue(undefined);
    const reporter = new ErrorReporter({ record } as unknown as ActionLogService);
    reporter.setAlertSender(vi.fn().mockResolvedValue(undefined));
    await reporter.report({ error, source: 'crm', context: 'crm-ozon:connect' });

    const everything = [
      ...logged,
      error.message,
      error.stack ?? '',
      error.userMessage,
      JSON.stringify(error),
      JSON.stringify(record.mock.calls),
    ].join('\n');
    expect(logged.length).toBeGreaterThan(0);
    expect(record.mock.calls[0][0]).toMatchObject({
      source: 'ozon',
      httpStatus: 401,
      requestUrl: 'POST /v1/roles',
    });
    expect(everything).not.toContain(API_KEY);
    expect(everything).not.toContain('SECRET');
  });
});

describe('ozon.errors', () => {
  it('класс выбирает код ответа', () => {
    expect(toOzonApiError(undefined, null, undefined, 'ECONNRESET')).toBeInstanceOf(
      OzonNetworkError,
    );
    expect(toOzonApiError(403, {}, undefined, 'x')).toBeInstanceOf(OzonAuthError);
    expect(toOzonApiError(500, {}, undefined, 'x')).toBeInstanceOf(OzonServerError);
    const bad = toOzonApiError(400, { code: 3, message: 'bad Client-Id' }, undefined, 'x');
    expect(bad).toBeInstanceOf(OzonRequestError);
    expect(bad).toBeInstanceOf(OzonApiError);
    expect(bad.retryable).toBe(false);
    expect(bad.message).toBe('bad Client-Id');
    expect(bad.userMessage).toContain('Ozon отклонил запрос');
  });

  it('400/404 — не «Ozon сейчас не отвечает»: отключённый метод назван честно', () => {
    const generic = new OzonApiError('x', 0).userMessage;
    const obsolete = toOzonApiError(
      400,
      { code: 9, message: 'obsolete method cannot be used' },
      undefined,
      'x',
    );
    const gone = toOzonApiError(404, {}, undefined, 'Request failed with status code 404');
    for (const error of [obsolete, gone]) {
      expect(error).toBeInstanceOf(OzonRequestError);
      expect(error.retryable).toBe(false);
      expect(error.userMessage).toContain('Ozon отключил метод API');
      expect(error.userMessage).not.toBe(generic);
    }
  });
});

describe('mapRoles', () => {
  it('мусор отбрасывается, нет срока — null', () => {
    expect(mapRoles({ roles: [{ name: '' }, null, { name: 'R', methods: [1, '/x'] }] })).toEqual({
      roles: [{ name: 'R', methods: ['/x'] }],
      expiresAt: null,
    });
    expect(mapRoles(undefined)).toEqual({ roles: [], expiresAt: null });
  });
});

describe('parseOzonCredentials', () => {
  it('Client-Id — положительное целое, Api-Key — без пробелов и не короче 16', () => {
    expect(parseOzonCredentials({ clientId: ' 1234567 ', apiKey: ` ${API_KEY} ` })).toEqual({
      ok: true,
      credentials: { clientId: CLIENT_ID, apiKey: API_KEY },
    });
    expect(parseOzonCredentials({ clientId: 'abc', apiKey: API_KEY })).toMatchObject({
      ok: false,
      field: 'clientId',
    });
    expect(parseOzonCredentials({ clientId: '0', apiKey: API_KEY })).toMatchObject({
      field: 'clientId',
    });
    expect(parseOzonCredentials({ clientId: CLIENT_ID, apiKey: 'short' })).toMatchObject({
      field: 'apiKey',
    });
    expect(
      parseOzonCredentials({ clientId: CLIENT_ID, apiKey: 'with space inside key' }),
    ).toMatchObject({ field: 'apiKey' });
    expect(parseOzonCredentials(null)).toMatchObject({ field: 'clientId' });
  });
});
