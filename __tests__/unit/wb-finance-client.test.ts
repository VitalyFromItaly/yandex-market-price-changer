import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { pickFinanceMarketplaces } from '../../src/modules/telegram/queue/services/finance-schedule';
import { WbMarketplaceAdapter } from '../../src/modules/wb/wb-marketplace.adapter';
import { WbNotConnectedError } from '../../src/modules/wb/wb-seller-client';
import { WbIncompleteResponseError } from '../../src/modules/wb/wb.errors';
import {
  WB_CATEGORY_HOSTS,
  WB_PATHS,
  WB_REPORT_DETAIL_LIMIT,
  WB_STATISTICS_INTERVAL_MS,
  WB_STATISTICS_MAX_PAGES,
  WbClient,
  mapWbRealization,
} from '../../src/modules/wb/wb.client';

/**
 * Отчёт реализации WB (TASK-136): клиент reportDetailByPeriod (курсор `rrdid`,
 * пауза «Статистики», неполный ответ — ошибка), возможность `finance` в реестре
 * и площадки ночной загрузки.
 */

const TOKEN = 'header.payload.SECRETsignatureSECRET0123456789abcdef';
const URL = `${WB_CATEGORY_HOSTS.statistics}${WB_PATHS.reportDetail}`;

function stubGet(answer: (params: any) => unknown) {
  const calls: any[] = [];
  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: { response: { use: () => undefined } },
        get: async (url: string, config?: any) => {
          expect(url).toBe(URL);
          calls.push(config?.params);
          return { data: await answer(config?.params) };
        },
      }) as never,
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('WbClient.listRealizationReport', () => {
  it('курсор rrdid до пустого ответа, пауза лимита перед каждой следующей страницей', async () => {
    const pages: Record<string, unknown> = {
      '0': [{ rrd_id: 1 }, { rrd_id: 2 }],
      '2': [{ rrd_id: 3 }],
      '3': [],
    };
    const calls = stubGet((params) => pages[params.rrdid]);
    const sleep = vi.fn(async () => undefined);

    const rows = await new WbClient(TOKEN, { sleep }).listRealizationReport(
      '2026-08-26',
      '2026-10-06',
    );

    expect(rows.map((r) => r.rrd_id)).toEqual([1, 2, 3]);
    expect(calls).toEqual([
      {
        dateFrom: '2026-08-26',
        dateTo: '2026-10-06',
        limit: WB_REPORT_DETAIL_LIMIT,
        rrdid: '0',
        period: 'weekly',
      },
      expect.objectContaining({ rrdid: '2' }),
      expect.objectContaining({ rrdid: '3' }),
    ]);
    expect(sleep.mock.calls).toEqual([[WB_STATISTICS_INTERVAL_MS], [WB_STATISTICS_INTERVAL_MS]]);
  });

  it('204 без тела — конец отчёта', async () => {
    stubGet(() => '');
    expect(
      await new WbClient(TOKEN, { sleep: async () => undefined }).listRealizationReport('a', 'b'),
    ).toEqual([]);
  });

  it('курсор не сдвинулся — неполный ответ, а не тихий стоп', async () => {
    stubGet(() => [{ rrd_id: 5 }]);
    const client = new WbClient(TOKEN, { sleep: async () => undefined });
    const error = await client.listRealizationReport('a', 'b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WbIncompleteResponseError);
    expect((error as WbIncompleteResponseError).userMessage).toContain('отчёт реализации');
  });

  it('потолок страниц — ошибка', async () => {
    let id = 0;
    stubGet(() => [{ rrd_id: (id += 1) }]);
    await expect(
      new WbClient(TOKEN, { sleep: async () => undefined }).listRealizationReport('a', 'b'),
    ).rejects.toThrow(String(WB_STATISTICS_MAX_PAGES));
  });

  it('маппер: мусор без rrd_id отброшен, счётчик и курсор — по пришедшему', () => {
    expect(
      mapWbRealization([{ rrd_id: 7 }, { rrd_id: 'x' }, null, { foo: 1 }, { rrd_id: '9' }]),
    ).toEqual({
      rows: [{ rrd_id: 7 }, { rrd_id: '9' }],
      count: 4,
      lastRrdId: '9',
    });
    expect(mapWbRealization(null)).toEqual({ rows: [], count: 0, lastRrdId: '' });
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
