import { Logger } from '@nestjs/common';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionLogService } from '../../src/database/services/action-log.service';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import {
  WB_REQUIRED_CATEGORIES,
  expiryOf,
  missingCategoriesText,
  parseWbToken,
} from '../../src/modules/wb/wb-connection.domain';
import { WbConnectionService } from '../../src/modules/wb/wb-connection.service';
import { WbStatisticsPacer } from '../../src/modules/wb/wb-statistics-pacer';
import {
  WB_CATEGORY_HOSTS,
  WB_COMMON_HOST,
  WB_PATHS,
  WB_STATISTICS_INTERVAL_MS,
  WB_TIMEOUT_MS,
  WbClient,
  mapSellerInfo,
} from '../../src/modules/wb/wb.client';
import {
  WbApiError,
  WbAuthError,
  WbNetworkError,
  WbRateLimitError,
  WbRequestError,
  WbServerError,
  toWbApiError,
} from '../../src/modules/wb/wb.errors';
import { reportErrorMessage } from '../../src/modules/yandex/reports/report-message';

/** JWT-образный токен с заданной полезной нагрузкой; подпись WB не проверяем. */
function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'ES256', kid: '2026' })}.${part(payload)}.SECRETsignatureSECRET0123456789`;
}

const NOW = new Date('2026-10-18T00:00:00Z');
const TOKEN = jwt({ exp: Math.floor(NOW.getTime() / 1000) + 86_400 * 180, sid: 'seller-1' });

/** Перехватывает axios.create и отвечает по адресу — образец ozon-client.test.ts. */
function stubAxios() {
  const created: Array<Record<string, any>> = [];
  const calls: string[] = [];
  let handler: (url: string) => unknown = () => ({});
  let onError: (error: unknown) => unknown = (e) => {
    throw e;
  };

  vi.spyOn(axios, 'create').mockImplementation((config: any) => {
    created.push(config);
    return {
      interceptors: {
        response: { use: (_ok: unknown, err: (e: unknown) => unknown) => (onError = err) },
      },
      get: async (url: string) => {
        calls.push(url);
        try {
          return { data: await handler(url) };
        } catch (raw) {
          return onError(raw);
        }
      },
    } as never;
  });

  const failure = (
    url: string,
    status: number | undefined,
    headers: Record<string, string> = {},
  ) => {
    const error: any = new Error(status ? `Request failed with status code ${status}` : 'timeout');
    // config с заголовками — как у настоящего axios: в нём лежит токен.
    error.config = { method: 'get', url, headers: { Authorization: TOKEN } };
    if (status) {
      error.response = {
        status,
        headers,
        data: {
          status,
          title: 'Unauthorized',
          detail: 'token scope not allowed',
          requestId: 'r-1',
        },
      };
    }
    throw error;
  };

  return {
    created,
    calls,
    handle(next: (url: string) => unknown) {
      handler = next;
    },
    failure,
  };
}

describe('WbClient', () => {
  let stub: ReturnType<typeof stubAxios>;
  let logged: string[];
  const sleep = vi.fn().mockResolvedValue(undefined);
  const client = () => new WbClient(TOKEN, { sleep });

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

  it('токен — в Authorization без Bearer, без прокси из env; ping — хост категории', async () => {
    stub.handle(() => ({ TS: '2026-10-18T00:00:00Z', Status: 'OK' }));
    await client().ping('statistics');
    expect(stub.created[0]).toMatchObject({
      timeout: WB_TIMEOUT_MS,
      proxy: false,
      headers: { Authorization: TOKEN },
    });
    expect(stub.calls).toEqual(['https://statistics-api.wildberries.ru/ping']);
  });

  it('seller-info — общий хост; мусор — пустые строки', async () => {
    stub.handle(() => ({ name: ' ИП Иванов ', sid: 'abc', tradeMark: 'Watch' }));
    expect(await client().sellerInfo()).toEqual({
      name: 'ИП Иванов',
      sid: 'abc',
      tradeMark: 'Watch',
    });
    expect(stub.calls).toEqual([`${WB_COMMON_HOST}/api/v1/seller-info`]);
    expect(mapSellerInfo(null)).toEqual({ name: '', sid: '', tradeMark: '' });
  });

  it('401 — WbAuthError сразу, без повторов; 429 с X-Ratelimit-Retry и 503 повторяются', async () => {
    const url = `${WB_CATEGORY_HOSTS.finance}/ping`;
    stub.handle((u) => stub.failure(u, 401));
    const error = await client()
      .ping('finance')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WbAuthError);
    expect((error as WbAuthError).request).toBe(`GET ${url}`);
    expect((error as WbAuthError).requestId).toBe('r-1');
    expect(sleep).not.toHaveBeenCalled();

    let n = 0;
    stub.handle((u) => {
      n += 1;
      if (n === 1) return stub.failure(u, 429, { 'x-ratelimit-retry': '2' });
      if (n === 2) return stub.failure(u, 503);
      return { Status: 'OK' };
    });
    await client().ping('finance');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 2000]);
  });

  describe('429 «Статистики» — повтор только через очередь (TASK-197)', () => {
    const ORDERS = `${WB_CATEGORY_HOSTS.statistics}${WB_PATHS.supplierOrders}`;
    let clock: number;
    const paced = () => {
      clock = 0;
      sleep.mockImplementation(async (ms: number) => {
        clock += ms;
      });
      return new WbClient(TOKEN, { sleep, pacer: new WbStatisticsPacer(() => clock) });
    };
    afterEach(() => sleep.mockImplementation(async () => undefined));

    it('без заголовка — второй запрос в следующий слот очереди, а не через 1 с', async () => {
      let n = 0;
      stub.handle((u) => (++n === 1 ? stub.failure(u, 429) : []));
      expect(await paced().listSupplierOrders('2026-10-01')).toEqual([]);
      expect(n).toBe(2);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([WB_STATISTICS_INTERVAL_MS]);
    });

    it('X-Ratelimit-Retry 45 с — один повтор: слот очереди покрывает паузу WB', async () => {
      let n = 0;
      stub.handle((u) => (++n === 1 ? stub.failure(u, 429, { 'x-ratelimit-retry': '45' }) : []));
      await paced().listSupplierOrders('2026-10-01');
      expect(stub.calls).toEqual([ORDERS, ORDERS]);
      expect(clock).toBe(WB_STATISTICS_INTERVAL_MS);
    });

    it('пауза дольше интервала (Базовый токен) и второй 429 — честный текст, не «не отвечает»', async () => {
      stub.handle((u) => stub.failure(u, 429, { 'x-ratelimit-retry': '10800' }));
      const long = await paced()
        .listSupplierOrders('2026-10-01')
        .catch((e: unknown) => e);
      expect(long).toBeInstanceOf(WbRateLimitError);
      expect(stub.calls).toHaveLength(1);
      expect(reportErrorMessage(long)).toBe(
        'Wildberries ограничил частоту запросов к этим данным. Попробуйте через 3 ч.',
      );

      stub.handle((u) => stub.failure(u, 429));
      const twice = await paced()
        .listSupplierOrders('2026-10-01')
        .catch((e: unknown) => e);
      expect(stub.calls).toHaveLength(3);
      expect(reportErrorMessage(twice)).toBe(
        'Wildberries ограничил частоту запросов к этим данным. Попробуйте через несколько минут.',
      );
      expect(reportErrorMessage(twice)).not.toContain('не отвечает');
    });
  });

  it('токен не попадает ни в логи, ни в ошибку, ни в журнал ErrorReporter (source: wb)', async () => {
    stub.handle((u) => stub.failure(u, 401));
    const error = (await client()
      .ping('content')
      .catch((e: unknown) => e)) as WbApiError;

    const record = vi.fn().mockResolvedValue(undefined);
    const reporter = new ErrorReporter({ record } as unknown as ActionLogService);
    reporter.setAlertSender(vi.fn().mockResolvedValue(undefined));
    await reporter.report({ error, source: 'crm', context: 'crm-wb:connect' });

    const everything = [
      ...logged,
      error.message,
      error.stack ?? '',
      error.userMessage,
      JSON.stringify(error),
      JSON.stringify(record.mock.calls),
    ].join('\n');
    expect(logged.length).toBeGreaterThan(0);
    expect(record.mock.calls[0][0]).toMatchObject({ source: 'wb', httpStatus: 401 });
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('SECRET');
  });
});

describe('wb.errors', () => {
  it('класс выбирает код ответа', () => {
    expect(toWbApiError(undefined, null, undefined, 'x')).toBeInstanceOf(WbNetworkError);
    expect(toWbApiError(403, {}, undefined, 'x')).toBeInstanceOf(WbAuthError);
    expect(toWbApiError(429, {}, '3', 'x')).toMatchObject({ retryAfterMs: 3000 });
    expect(toWbApiError(502, {}, undefined, 'x')).toBeInstanceOf(WbServerError);
    expect(toWbApiError(400, { detail: 'плохо' }, undefined, 'x').message).toBe('плохо');
    expect(new WbRateLimitError('x', 429).retryable).toBe(true);
  });

  it('отключённый метод и отвергнутый запрос — WbRequestError с честным текстом (TASK-197)', () => {
    const deprecated = toWbApiError(400, { detail: 'This method is deprecated' }, undefined, 'x');
    expect(deprecated).toBeInstanceOf(WbRequestError);
    expect((deprecated as WbRequestError).obsolete).toBe(true);
    expect(deprecated.retryable).toBe(false);
    expect(deprecated.userMessage).toBe(
      'Wildberries отключил метод API, которым бот читает эти данные. ' +
        'Это ошибка на нашей стороне — мы уже знаем и исправляем.',
    );
    expect(toWbApiError(404, {}, undefined, 'x')).toMatchObject({ obsolete: true });
    expect(toWbApiError(410, {}, undefined, 'x')).toMatchObject({ obsolete: true });
    expect(toWbApiError(422, { title: 'deprecated' }, undefined, 'x')).toBeInstanceOf(
      WbRequestError,
    );
    const rejected = toWbApiError(400, { detail: 'bad nmIds' }, undefined, 'x');
    expect(rejected.userMessage).toBe(
      'Wildberries отклонил запрос бота. Это ошибка на нашей стороне — мы уже знаем и исправляем.',
    );
    expect(rejected.userMessage).not.toContain('не отвечает');
    expect(toWbApiError(409, {}, undefined, 'x')).not.toBeInstanceOf(WbRequestError);
  });
});

describe('parseWbToken', () => {
  it('JWT из трёх частей; мусор и истёкший — свой текст', () => {
    expect(parseWbToken({ token: ` ${TOKEN} ` }, NOW)).toEqual({ ok: true, token: TOKEN });
    expect(parseWbToken({ token: 'garbage' }, NOW)).toMatchObject({ ok: false });
    expect(parseWbToken({}, NOW)).toMatchObject({ ok: false });
    const expired = jwt({ exp: Math.floor(NOW.getTime() / 1000) - 60 });
    const result = parseWbToken({ token: expired }, NOW);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.message).toContain('истёк');
  });

  it('нечитаемая полезная нагрузка — срок неизвестен, решает WB', () => {
    expect(expiryOf('aaaa.bbbb.cccc')).toBeNull();
    expect(parseWbToken({ token: `${'a'.repeat(30)}.${'b'.repeat(30)}.cccc` }, NOW)).toMatchObject({
      ok: true,
    });
  });

  it('перечень недостающих категорий — названиями из кабинета WB', () => {
    expect(missingCategoriesText(['finance', 'analytics'])).toContain('«Финансы», «Аналитика»');
  });
});

describe('WbConnectionService.verify', () => {
  const origin = { telegramUserId: '1', source: 'crm' as const, context: 'test' };

  function service(ping: (category: string) => Promise<void>, sellerInfo = vi.fn()) {
    const report = vi.fn().mockResolvedValue(undefined);
    const clients = { forToken: vi.fn(() => ({ ping: vi.fn(ping), sellerInfo })) };
    const wb = new WbConnectionService(clients as never, {} as never, { report } as never);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    return { wb, report, clients };
  }

  afterEach(() => vi.restoreAllMocks());

  it('все категории открыты — ок с названием кабинета', async () => {
    const sellerInfo = vi.fn().mockResolvedValue({ name: '', sid: 's1', tradeMark: 'Watch' });
    const { wb } = service(async () => undefined, sellerInfo);
    expect(await wb.verify(TOKEN, origin)).toEqual({
      ok: true,
      seller: { sid: 's1', name: 'Watch' },
    });
  });

  it('отказ на всех — «токен не принят»; на части — перечень, без алерта', async () => {
    const all = service(async () => {
      throw new WbAuthError('bad', 401);
    });
    expect(await all.wb.verify(TOKEN, origin)).toMatchObject({ ok: false, reason: 'auth' });

    const partial = service(async (category) => {
      if (category === 'finance') throw new WbAuthError('scope', 401);
    });
    const result = await partial.wb.verify(TOKEN, origin);
    expect(result).toMatchObject({ ok: false, reason: 'scopes', missing: ['finance'] });
    expect(result.ok === false && 'message' in result && result.message).toContain('«Финансы»');
    expect(partial.report).toHaveBeenCalledWith(expect.objectContaining({ alert: false }));
  });

  it('сеть или 5xx — «WB недоступен» с алертом, дальше категории не спрашиваются', async () => {
    const calls: string[] = [];
    const { wb, report } = service(async (category) => {
      calls.push(category);
      throw new WbServerError('boom', 502);
    });
    expect(await wb.verify(TOKEN, origin)).toEqual({ ok: false, reason: 'unavailable' });
    expect(calls).toEqual([WB_REQUIRED_CATEGORIES[0]]);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ alert: true }));
  });

  it('seller-info упал — подключение всё равно состоялось', async () => {
    const { wb } = service(
      async () => undefined,
      vi.fn().mockRejectedValue(new WbNetworkError('timeout')),
    );
    expect(await wb.verify(TOKEN, origin)).toEqual({ ok: true, seller: { sid: '', name: '' } });
  });
});
