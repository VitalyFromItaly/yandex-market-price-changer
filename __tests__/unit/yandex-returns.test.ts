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
    const calls = stubAxios([{ result: { returns: [] } }]);
    await client().getReturns();

    expect(calls[0].path).toBe(`/${API_VERSIONS.returns}/campaigns/12345/returns`);
    expect(calls[0].path).toContain('/v2/');
  });

  it('отбор возвратов в пути идёт через shipmentStatuses', async () => {
    const calls = stubAxios([{ result: { returns: [] } }]);
    await client().getReturns({
      shipmentStatuses: [RETURN_SHIPMENT_STATUS.IN_TRANSIT],
    });

    expect(calls[0].shipmentStatuses).toEqual(['IN_TRANSIT']);
  });

  it('суммы читаются из amount, а не из устаревшего refundAmount', async () => {
    // refundAmount приходит числом без валюты и однажды исчезнет.
    stubAxios([
      {
        result: {
          returns: [
            {
              returnId: 1,
              orderId: 555,
              amount: { value: 2500, currencyId: 'RUR' },
              refundAmount: 999,
            },
          ],
        },
      },
    ]);

    const page = await client().getReturns();

    expect(page.items[0].amount).toEqual({ value: 2500, currencyId: 'RUR' });
    expect(page.items[0]).not.toHaveProperty('refundAmount');
  });

  it('компенсация читается из partnerCompensationAmount', async () => {
    stubAxios([
      {
        result: {
          returns: [
            {
              returnId: 2,
              partnerCompensationAmount: { value: 300, currencyId: 'RUR' },
              partnerCompensation: 111,
            },
          ],
        },
      },
    ]);

    const page = await client().getReturns();

    expect(page.items[0].partnerCompensationAmount).toEqual({ value: 300, currencyId: 'RUR' });
    expect(page.items[0]).not.toHaveProperty('partnerCompensation');
  });

  it('сырой ответ сохраняется — отчётам нужны и другие поля', async () => {
    stubAxios([{ result: { returns: [{ returnId: 3, someOtherField: 'x' }] } }]);

    const page = await client().getReturns();
    expect((page.items[0].raw as { someOtherField: string }).someOtherField).toBe('x');
  });

  it('пустой список возвратов — нормальный ответ, а не ошибка', async () => {
    // У продавца просто может не быть возвратов; отчёт должен сказать «ноль»,
    // а не «ошибка получения данных».
    stubAxios([{ result: { returns: [] } }]);
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
      { result: { returns: [{ returnId: 1 }], paging: { nextPageToken: 'p2' } } },
      { result: { returns: [{ returnId: 2 }] } },
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

/**
 * Форма ответа: у возвратов полезная нагрузка лежит в `result`, у заказов — на
 * верхнем уровне. Пока клиент читал `data.returns`, поле всегда было
 * `undefined`, метод молча отдавал пустой список, и отчёт «Едет обратно»
 * показывал только невыкупы из заказов. Ошибки при этом не возникало ни одной:
 * «возвратов нет» — законный ответ.
 */
describe('Возвраты завёрнуты в result', () => {
  it('читает боевую форму ответа — result.returns', async () => {
    stubAxios([{ status: 'OK', result: { returns: [{ returnId: 1, orderId: 42 }], paging: {} } }]);

    const page = await client().getReturns();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].orderId).toBe(42);
  });

  it('терпит и плоскую форму — Яндекс уже расходится между методами', async () => {
    stubAxios([{ returns: [{ returnId: 2, orderId: 7 }] }]);

    const page = await client().getReturns();

    expect(page.items).toHaveLength(1);
    expect(page.items[0].orderId).toBe(7);
  });

  it('pageToken тоже берётся из result', async () => {
    stubAxios([{ result: { returns: [{ returnId: 1 }], paging: { nextPageToken: 'p2' } } }]);

    const page = await client().getReturns();

    expect(page.nextPageToken).toBe('p2');
  });

  it('дата оформления доезжает до отчёта — по ней режется период', async () => {
    stubAxios([
      { result: { returns: [{ returnId: 1, creationDate: '2026-08-01T17:29:02.452+03:00' }] } },
    ]);

    const page = await client().getReturns();

    expect(page.items[0].creationDate).toBe('2026-08-01T17:29:02.452+03:00');
  });
});

/**
 * Позиции возврата нужны выгрузке «Едет обратно» .xlsx-файлом. В ответе Яндекса
 * артикул называется shopSku; у нас он переименован в offerId, чтобы позиции
 * возврата и позиции заказа имели одну форму ниже по течению.
 */
describe('Позиции возврата', () => {
  it('items маппятся, shopSku становится offerId', async () => {
    stubAxios([
      {
        result: {
          returns: [
            {
              returnId: 1,
              items: [{ shopSku: 'ABC-123', marketSku: 42, count: 2 }],
            },
          ],
        },
      },
    ]);

    const page = await client().getReturns();

    expect(page.items[0].items).toEqual([{ offerId: 'ABC-123', marketSku: 42, count: 2 }]);
    // Переименование закреплено: поля с именем из ответа Яндекса на записи нет.
    expect(page.items[0].items[0]).not.toHaveProperty('shopSku');
  });

  it('возврат без items не падает — поле остаётся пустым', async () => {
    stubAxios([{ result: { returns: [{ returnId: 2 }] } }]);

    const page = await client().getReturns();

    expect(page.items[0].items).toBeUndefined();
  });
});
