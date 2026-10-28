import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { pickFinanceMarketplaces } from '../../src/modules/telegram/queue/services/finance-schedule';
import { WbMarketplaceAdapter } from '../../src/modules/wb/wb-marketplace.adapter';
import { WbClientFactory } from '../../src/modules/wb/wb-client.factory';
import { WbNotConnectedError } from '../../src/modules/wb/wb-seller-client';
import { WbStatisticsPacer } from '../../src/modules/wb/wb-statistics-pacer';
import { WbIncompleteResponseError } from '../../src/modules/wb/wb.errors';
import {
  WB_CATEGORY_HOSTS,
  WB_PATHS,
  WB_REPORT_DETAIL_LIMIT,
  WB_REPORT_FIELDS,
  WB_STATISTICS_INTERVAL_MS,
  WB_STATISTICS_MAX_PAGES,
  WbClient,
  mapWbRealization,
} from '../../src/modules/wb/wb.client';

/**
 * Отчёт реализации WB (TASK-136): клиент `POST finance-api …/sales-reports/detailed`
 * (заменил reportDetailByPeriod; курсор `rrdId`, пауза лимита, неполный ответ —
 * ошибка, поля — в прежних именах), возможность `finance` в реестре и площадки
 * ночной загрузки.
 */

const TOKEN = 'header.payload.SECRETsignatureSECRET0123456789abcdef';
const URL = `${WB_CATEGORY_HOSTS.finance}${WB_PATHS.reportDetail}`;

function stubGet(answer: (body: any) => unknown) {
  const calls: any[] = [];
  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: { response: { use: () => undefined } },
        post: async (url: string, body?: any) => {
          expect(url).toBe(URL);
          calls.push(body);
          return { data: await answer(body) };
        },
      }) as never,
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('WbClient.listRealizationReport', () => {
  it('POST в «Финансы», курсор rrdId до пустого ответа, пауза лимита перед каждой следующей страницей', async () => {
    const pages: Record<string, unknown> = {
      '0': [{ rrdId: 1 }, { rrdId: 2 }],
      '2': [{ rrdId: 3 }],
      '3': [],
    };
    const calls = stubGet((body) => pages[String(body.rrdId)]);
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });

    const rows = await new WbClient(TOKEN, {
      sleep,
      pacer: new WbStatisticsPacer(() => clock),
    }).listRealizationReport('2026-08-26', '2026-10-06');

    expect(rows.map((r) => r.rrd_id)).toEqual([1, 2, 3]);
    expect(calls).toEqual([
      {
        dateFrom: '2026-08-26',
        dateTo: '2026-10-06',
        limit: WB_REPORT_DETAIL_LIMIT,
        rrdId: 0,
        period: 'weekly',
        fields: WB_REPORT_FIELDS,
      },
      expect.objectContaining({ rrdId: 2 }),
      expect.objectContaining({ rrdId: 3 }),
    ]);
    expect(sleep.mock.calls).toEqual([[WB_STATISTICS_INTERVAL_MS], [WB_STATISTICS_INTERVAL_MS]]);
  });

  it('лимит — на токен, а не на экземпляр: новый клиент того же продавца ждёт остаток интервала', async () => {
    stubGet(() => []);
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const pacer = new WbStatisticsPacer(() => clock);
    const month = (token: string) =>
      new WbClient(token, { sleep, pacer }).listRealizationReport('a', 'b');

    await month(TOKEN);
    clock += 5_000;
    await month(TOKEN);
    await month('другой-токен');

    // Второй месяц того же токена — через минуту после первого; чужой токен не ждёт.
    expect(sleep.mock.calls).toEqual([[WB_STATISTICS_INTERVAL_MS - 5_000]]);
  });

  it('фабрика отдаёт клиентам одну очередь на процесс', async () => {
    stubGet(() => []);
    const sleep = vi.fn(async () => undefined);
    const factory = new WbClientFactory();

    await factory.forToken(TOKEN, { sleep }).listRealizationReport('a', 'b');
    await factory.forToken(TOKEN, { sleep }).listRealizationReport('a', 'b');

    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('204 без тела — конец отчёта', async () => {
    stubGet(() => '');
    expect(
      await new WbClient(TOKEN, { sleep: async () => undefined }).listRealizationReport('a', 'b'),
    ).toEqual([]);
  });

  it('курсор не сдвинулся — неполный ответ, а не тихий стоп', async () => {
    stubGet(() => [{ rrdId: 5 }]);
    const client = new WbClient(TOKEN, { sleep: async () => undefined });
    const error = await client.listRealizationReport('a', 'b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WbIncompleteResponseError);
    expect((error as WbIncompleteResponseError).userMessage).toContain('отчёт реализации');
  });

  it('потолок страниц — ошибка', async () => {
    let id = 0;
    stubGet(() => [{ rrdId: (id += 1) }]);
    await expect(
      new WbClient(TOKEN, { sleep: async () => undefined }).listRealizationReport('a', 'b'),
    ).rejects.toThrow(String(WB_STATISTICS_MAX_PAGES));
  });

  it('маппер: мусор без rrdId отброшен, счётчик и курсор — по пришедшему', () => {
    expect(
      mapWbRealization([{ rrdId: 7 }, { rrdId: 'x' }, null, { foo: 1 }, { rrdId: '9' }]),
    ).toEqual({
      rows: [{ rrd_id: 7 }, { rrd_id: '9' }],
      count: 4,
      lastRrdId: '9',
    });
    expect(mapWbRealization(null)).toEqual({ rows: [], count: 0, lastRrdId: '' });
  });

  it('маппер: новые имена → прежние (журнал читает их), деньги строками — как пришли; ответ под data', () => {
    const row = {
      rrdId: 11,
      reportId: 555,
      createDate: '2026-10-06',
      rrDate: '2026-10-01',
      docTypeName: 'Продажа',
      sellerOperName: 'Продажа',
      vendorCode: 'CASIO-1',
      srid: 'abc',
      retailPriceWithDisc: '1000.50',
      acquiringFee: '15.01',
      forPay: '850.00',
      deliveryService: '60',
      returnAmount: 0,
      paidStorage: '1.5',
      paidAcceptance: '0',
      additionalPayment: '0',
      title: 'Часы',
      sku: '2000000000001',
    };
    const legacy = {
      rrd_id: 11,
      realizationreport_id: 555,
      create_dt: '2026-10-06',
      rr_dt: '2026-10-01',
      doc_type_name: 'Продажа',
      supplier_oper_name: 'Продажа',
      sa_name: 'CASIO-1',
      srid: 'abc',
      retail_price_withdisc_rub: '1000.50',
      acquiring_fee: '15.01',
      ppvz_for_pay: '850.00',
      delivery_rub: '60',
      return_amount: 0,
      storage_fee: '1.5',
      acceptance: '0',
      additional_payment: '0',
      title: 'Часы',
      barcode: '2000000000001',
    };
    expect(mapWbRealization([row]).rows).toEqual([legacy]);
    expect(mapWbRealization({ data: [row] }).rows).toEqual([legacy]);
    expect(mapWbRealization({ data: { details: [row] } }).rows).toEqual([legacy]);
  });
});

describe('WbMarketplaceAdapter.finance', () => {
  const ref = { telegramUserId: '111', marketplace: 'wb' as const };
  const period = { from: '2026-09-01', to: '2026-09-30' };
  const adapter = (importPeriod: (...args: unknown[]) => unknown) =>
    new WbMarketplaceAdapter(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { importPeriod } as never,
    );

  it('делегирует WbFinanceService, без токена — отказ реестра', async () => {
    const importPeriod = vi.fn(async () => ({ status: 'empty', period }));
    expect(await adapter(importPeriod).finance.importFinance(ref, period)).toEqual({
      status: 'empty',
      period,
    });
    expect(importPeriod).toHaveBeenCalledWith('111', period);

    const missing = adapter(async () => {
      throw new WbNotConnectedError('111');
    });
    await expect(missing.finance.importFinance(ref, period)).rejects.toBeInstanceOf(
      MarketplaceNotConnectedError,
    );
  });
});

describe('pickFinanceMarketplaces: WB', () => {
  it('WB — токен плюс фичи finance и wb; админ — без флагов; порядок ЯМ, Ozon, WB', () => {
    const accounts = [
      {
        telegramUserId: '1',
        status: 'approved',
        features: { finance: true, ozon: true, wb: true },
      },
      { telegramUserId: '2', status: 'approved', features: { finance: true } },
      { telegramUserId: '3', status: 'approved', features: { wb: true } },
      { telegramUserId: '4', status: 'pending', features: { finance: true, wb: true } },
    ];
    const result = pickFinanceMarketplaces(accounts, [9], {
      ym: new Set(['1', '9']),
      ozon: new Set(['1', '9']),
      wb: new Set(['1', '2', '3', '4', '9']),
    });
    expect(Object.fromEntries(result)).toEqual({
      '1': ['ym', 'ozon', 'wb'],
      '9': ['ym', 'ozon', 'wb'],
    });
  });
});
