import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { OzonMarketplaceAdapter } from '../../src/modules/ozon/ozon-marketplace.adapter';
import { OzonNotConnectedError } from '../../src/modules/ozon/ozon-seller-client';
import {
  OZON_FINANCE_PAGE_SIZE,
  OZON_PATHS,
  OzonSellerClient,
  mapFinanceTransactions,
} from '../../src/modules/ozon/ozon.client';
import { pickFinanceMarketplaces } from '../../src/modules/telegram/queue/services/finance-schedule';

/**
 * Финансовые операции Ozon (TASK-131): клиент /v3/finance/transaction/list,
 * возможность `finance` в реестре и площадки ночной загрузки.
 */

const API_KEY = 'aaaaaaaa-SECRET-bbbb-cccc-0123456789ab';

/** axios.create → фейк, отвечающий по пути (образец ozon-orders.test.ts). */
function stubRoutes(routes: Record<string, (body: any) => unknown>) {
  const calls: Array<{ path: string; body: any }> = [];
  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: { response: { use: () => undefined } },
        post: async (path: string, body: any) => {
          calls.push({ path, body });
          return { data: await routes[path](body) };
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

const op = (id: number) => ({ operation_id: id, operation_type: 'X', amount: 1 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OzonSellerClient.listFinanceOperations', () => {
  it('страницы с 1 до page_count; тело — даты, все типы, страница', async () => {
    const pages: Record<number, unknown> = {
      1: { result: { operations: [op(1), op(2)], page_count: 2, row_count: 3 } },
      2: { result: { operations: [op(3)], page_count: 2, row_count: 3 } },
    };
    const calls = stubRoutes({
      [OZON_PATHS.financeTransactions]: (body) => pages[body.page],
    });
    const from = new Date('2026-08-31T21:00:00Z');
    const to = new Date('2026-09-30T20:59:59.999Z');

    const ops = await client().listFinanceOperations(from, to);

    expect(ops.map((o) => o.operation_id)).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.body.page)).toEqual([1, 2]);
    expect(calls[0].body).toEqual({
      filter: {
        date: { from: from.toISOString(), to: to.toISOString() },
        operation_type: [],
        posting_number: '',
        transaction_type: 'all',
      },
      page: 1,
      page_size: OZON_FINANCE_PAGE_SIZE,
    });
  });

  it('собрано меньше row_count — ошибка, а не неполный журнал', async () => {
    stubRoutes({
      [OZON_PATHS.financeTransactions]: () => ({
        result: { operations: [op(1)], page_count: 1, row_count: 2 },
      }),
    });
    await expect(client().listFinanceOperations(new Date(), new Date())).rejects.toThrow(
      /1 операций из 2/,
    );
  });

  it('разбор: оба уровня, без operation_id отбрасывается, операции сырыми', () => {
    expect(
      mapFinanceTransactions({ operations: [op(1), { amount: 5 }, null], page_count: '1' }),
    ).toEqual({ operations: [op(1)], pageCount: 1, rowCount: 0 });
    expect(mapFinanceTransactions(null)).toEqual({ operations: [], pageCount: 0, rowCount: 0 });
  });
});

describe('OzonMarketplaceAdapter.finance', () => {
  const ref = { telegramUserId: '111', marketplace: 'ozon' as const };
  const period = { from: '2026-09-01', to: '2026-09-30' };

  const adapter = (importPeriod: (...args: unknown[]) => unknown) =>
    new OzonMarketplaceAdapter(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        importPeriod,
      } as never,
    );

  it('делегирует OzonFinanceService, без ключа — отказ реестра', async () => {
    const importPeriod = vi.fn(async () => ({ status: 'empty', period }));
    expect(await adapter(importPeriod).finance.importFinance(ref, period)).toEqual({
      status: 'empty',
      period,
    });
    expect(importPeriod).toHaveBeenCalledWith('111', period);

    const missing = adapter(async () => {
      throw new OzonNotConnectedError('111');
    });
    await expect(missing.finance.importFinance(ref, period)).rejects.toBeInstanceOf(
      MarketplaceNotConnectedError,
    );
  });
});

describe('pickFinanceMarketplaces', () => {
  it('ЯМ — прежнее правило; Ozon — ключ плюс фичи finance и ozon; админ — без флагов', () => {
    const accounts = [
      { telegramUserId: '1', status: 'approved', features: { finance: true, ozon: true } },
      { telegramUserId: '2', status: 'approved', features: { finance: true } },
      { telegramUserId: '3', status: 'approved', features: { ozon: true } },
      { telegramUserId: '4', status: 'pending', features: { finance: true, ozon: true } },
    ];
    const result = pickFinanceMarketplaces(accounts, [9], {
      ym: new Set(['1', '2', '9']),
      ozon: new Set(['1', '2', '3', '4', '9']),
      wb: new Set(),
    });
    expect(Object.fromEntries(result)).toEqual({
      '1': ['ym', 'ozon'],
      '2': ['ym'],
      '9': ['ym', 'ozon'],
    });
  });
});
