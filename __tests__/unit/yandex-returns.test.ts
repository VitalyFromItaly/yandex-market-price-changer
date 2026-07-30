import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import { YandexApiClient } from '../../src/modules/yandex/yandex-api.client';
import { API_VERSIONS } from '../../src/modules/yandex/yandex-api.paths';
import { RETURN_SHIPMENT_STATUS } from '../../src/modules/yandex/reports/report-status-map';

const BASE_URL = 'https://api.partner.market.yandex.ru';
const CREDS = { token: 'ACMA:secret', campaignId: '12345', businessId: '67890' };

function stubAxios(pages: unknown[]) {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  vi.spyOn(axios, 'create').mockImplementation(
    () =>
      ({
        interceptors: { response: { use: () => undefined } },
        get: async (path: string, opts: { params: Record<string, unknown> }) => {
          calls.push({ path, ...opts.params });
          const data = pages[Math.min(i, pages.length - 1)];
          i += 1;
          return { data };
        },
      }) as never,
  );
  return calls;
}

const client = () => new YandexApiClient(CREDS, BASE_URL, { sleep: async () => undefined });

/**
 * Возвраты нужны отчёту «едет обратно». Главный риск здесь — не падение, а
 * тихо неверная сумма: устаревшие поля Яндекс всё ещё присылает, и прочитать
 * их по привычке очень легко.
 */
describe('Метод возвратов', () => {
  afterEach(() => vi.restoreAllMocks());

  it('путь содержит версию v2', async () => {
    const calls = stubAxios([{ returns: [] }]);
    await client().getReturns();

    expect(calls[0].path).toBe(`/${API_VERSIONS.returns}/campaigns/12345/returns`);
    expect(calls[0].path).toContain('/v2/');
  });

  it('отбор возвратов в пути идёт через shipmentStatuses', async () => {
    const calls = stubAxios([{ returns: [] }]);
    await client().getReturns({
      shipmentStatuses: [RETURN_SHIPMENT_STATUS.IN_TRANSIT],
    });

    expect(calls[0].shipmentStatuses).toEqual(['IN_TRANSIT']);
  });

  it('суммы читаются из amount, а не из устаревшего refundAmount', async () => {
    // refundAmount приходит числом без валюты и однажды исчезнет.
    stubAxios([
      {
        returns: [
          {
            returnId: 1,
            orderId: 555,
            amount: { value: 2500, currencyId: 'RUR' },
            refundAmount: 999,
          },
        ],
      },
    ]);

    const page = await client().getReturns();

    expect(page.items[0].amount).toEqual({ value: 2500, currencyId: 'RUR' });
    expect(page.items[0]).not.toHaveProperty('refundAmount');
  });

  it('компенсация читается из partnerCompensationAmount', async () => {
    stubAxios([
      {
        returns: [
          {
            returnId: 2,
            partnerCompensationAmount: { value: 300, currencyId: 'RUR' },
            partnerCompensation: 111,
          },
        ],
      },
    ]);

    const page = await client().getReturns();

    expect(page.items[0].partnerCompensationAmount).toEqual({ value: 300, currencyId: 'RUR' });
    expect(page.items[0]).not.toHaveProperty('partnerCompensation');
  });

  it('сырой ответ сохраняется — отчётам нужны и другие поля', async () => {
    stubAxios([{ returns: [{ returnId: 3, someOtherField: 'x' }] }]);

    const page = await client().getReturns();
    expect((page.items[0].raw as { someOtherField: string }).someOtherField).toBe('x');
  });

  it('пустой список возвратов — нормальный ответ, а не ошибка', async () => {
    // У продавца просто может не быть возвратов; отчёт должен сказать «ноль»,
    // а не «ошибка получения данных».
    stubAxios([{ returns: [] }]);
    const page = await client().getReturns();

    expect(page.items).toEqual([]);
    expect(page.nextPageToken).toBeUndefined();
  });

  it('отсутствие поля returns вовсе тоже не роняет разбор', async () => {
    stubAxios([{}]);
    expect((await client().getReturns()).items).toEqual([]);
  });

  it('пагинация работает и сохраняет фильтр на всех страницах', async () => {
    const calls = stubAxios([
      { returns: [{ returnId: 1 }], paging: { nextPageToken: 'p2' } },
      { returns: [{ returnId: 2 }] },
    ]);

    const all: unknown[] = [];
    for await (const page of client().iterateReturns({
      shipmentStatuses: [RETURN_SHIPMENT_STATUS.IN_TRANSIT],
    })) {
      all.push(...page);
    }

    expect(all).toHaveLength(2);
    expect(calls.map((c) => c.pageToken)).toEqual([undefined, 'p2']);
    // Фильтр не должен теряться на второй странице — иначе она придёт с чужими
    // возвратами и отчёт молча раздуется.
    expect(calls.every((c) => Array.isArray(c.shipmentStatuses))).toBe(true);
  });
});

// Инвариант «устаревшие денежные поля не используются» живёт в
// report-money-day.test.ts — единым списком DEPRECATED_MONEY_FIELDS и с
// единственным исключением для money.ts, где этот список и объявлен.
// Дублировать его здесь значило бы поддерживать две расходящиеся проверки.
