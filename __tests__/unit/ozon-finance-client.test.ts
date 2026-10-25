import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceNotConnectedError } from '../../src/modules/marketplaces/marketplace-adapter';
import { OzonMarketplaceAdapter } from '../../src/modules/ozon/ozon-marketplace.adapter';
import { OzonNotConnectedError } from '../../src/modules/ozon/ozon-seller-client';
import {
  OZON_PATHS,
  OzonSellerClient,
  mapAccrualTypes,
  mapAccrualsByDay,
  mapFinanceBalance,
} from '../../src/modules/ozon/ozon.client';
import { pickFinanceMarketplaces } from '../../src/modules/telegram/queue/services/finance-schedule';

/**
 * Финансовые операции Ozon (TASK-131, TASK-194): клиент начислений
 * /v1/finance/accrual/by-day и справочника типов, возможность `finance` в
 * реестре и площадки ночной загрузки. Форма ответа — из спецификации Seller API.
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

const accrual = (id: number, date = '2026-09-16') => ({
  accrual_id: id,
  date,
  accrued_category: 'NON_ITEM',
  total_amount: { amount: '-1.00', currency: 'RUB' },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OzonSellerClient.listAccrualsByDay', () => {
  it('курсор last_id с тем же date; пустой курсор — конец; дубли по accrual_id схлопываются', async () => {
    const pages: Record<string, unknown> = {
      '': { accruals: [accrual(1), accrual(2)], last_id: 'c1' },
      c1: { accruals: [accrual(2), accrual(3)], last_id: '' },
    };
    const calls = stubRoutes({ [OZON_PATHS.financeAccrualByDay]: (body) => pages[body.last_id] });

    const list = await client().listAccrualsByDay('2026-09-16');

    expect(list.map((a) => a.accrual_id)).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.body)).toEqual([
      { date: '2026-09-16', last_id: '' },
      { date: '2026-09-16', last_id: 'c1' },
    ]);
  });

  it('тот же курсор по кругу — ошибка, а не неполный список', async () => {
    stubRoutes({
      [OZON_PATHS.financeAccrualByDay]: () => ({ accruals: [accrual(1)], last_id: 'loop' }),
    });
    await expect(client().listAccrualsByDay('2026-09-16')).rejects.toThrow(/тот же курсор/);
  });

  it('ответ без массива accruals — ошибка: это не пустой день', async () => {
    stubRoutes({ [OZON_PATHS.financeAccrualByDay]: () => ({ result: {} }) });
    await expect(client().listAccrualsByDay('2026-09-16')).rejects.toThrow(/не отдал/);
  });

  it('listAccruals — по дню на запрос, последовательно, включая последний', async () => {
    const calls = stubRoutes({
      [OZON_PATHS.financeAccrualByDay]: (body) => ({
        accruals: [accrual(Number(body.date.slice(-2)), body.date)],
        last_id: '',
      }),
    });

    const list = await client().listAccruals('2026-09-29', '2026-10-01');

    expect(calls.map((c) => c.body.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(list).toHaveLength(3);
  });

  it('разбор: оба уровня, без accrual_id отбрасывается, начисления сырыми', () => {
    expect(mapAccrualsByDay({ accruals: [accrual(1), { date: 'x' }, null], last_id: 7 })).toEqual({
      accruals: [accrual(1)],
      lastId: '7',
      complete: true,
    });
    expect(mapAccrualsByDay({ result: { accruals: [], last_id: '' } }).complete).toBe(true);
    expect(mapAccrualsByDay(null)).toEqual({ accruals: [], lastId: '', complete: false });
  });

  it('справочник типов: id строкой, без id отбрасывается', async () => {
    const calls = stubRoutes({
      [OZON_PATHS.financeAccrualTypes]: () => ({
        accrual_types: [
          { id: 1, name: 'Acquiring', description: 'Эквайринг' },
          { name: 'NoId' },
        ],
      }),
    });
    expect(await client().listAccrualTypes()).toEqual([
      { id: '1', name: 'Acquiring', description: 'Эквайринг' },
    ]);
    expect(calls[0]).toEqual({ path: OZON_PATHS.financeAccrualTypes, body: {} });
    expect(mapAccrualTypes(null)).toEqual([]);
  });
});

describe('OzonSellerClient.balanceOfDay (TASK-184)', () => {
  /** Форма из спецификации FinanceAPI_FinanceBalance — живого примера нет (known-gaps). */
  const balance = (payments: unknown[]) => ({
    total: {
      opening_balance: { currency_code: 'RUB', value: 1500.5 },
      accrued: { currency_code: 'RUB', value: 300 },
      closing_balance: { currency_code: 'RUB', value: 800.5 },
      payments,
    },
  });

  it('один день: date_from = date_to; рубли → копейки, выплаты суммируются', async () => {
    const calls = stubRoutes({
      [OZON_PATHS.financeBalance]: () =>
        balance([
          { currency_code: 'RUB', value: 1000 },
          { currency_code: 'RUB', value: 0.25 },
        ]),
    });

    expect(await client().balanceOfDay('2026-10-05')).toEqual({
      openingKopecks: 150050,
      paymentsKopecks: 100025,
    });
    expect(calls).toEqual([
      { path: '/v1/finance/balance', body: { date_from: '2026-10-05', date_to: '2026-10-05' } },
    ]);
  });

  it('разбор: обёртка result, голые числа, пустые выплаты, знак выплаты — модулем', () => {
    expect(mapFinanceBalance({ result: { total: { opening_balance: 10, payments: [] } } }, 'd')).toEqual({
      openingKopecks: 1000,
      paymentsKopecks: 0,
    });
    expect(
      mapFinanceBalance(balance([{ currency_code: 'RUB', value: -700 }]), 'd').paymentsKopecks,
    ).toBe(70000);
  });

  it('нет total, нет сальдо или чужая валюта — ошибка, а не нули', () => {
    expect(() => mapFinanceBalance({}, '2026-10-05')).toThrow(/сальдо за 2026-10-05/);
    expect(() => mapFinanceBalance({ total: { payments: [] } }, 'd')).toThrow(/входящее сальдо/);
    expect(() =>
      mapFinanceBalance(balance([{ currency_code: 'USD', value: 1 }]), 'd'),
    ).toThrow(/USD/);
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
