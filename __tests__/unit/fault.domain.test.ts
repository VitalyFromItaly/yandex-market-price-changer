import { DrizzleQueryError } from 'drizzle-orm';
import { describe, it, expect } from 'vitest';

import { PolzaApiError, PolzaInsufficientFundsError } from '../../src/modules/ai/polza.errors';
import { faultLine, faultOf } from '../../src/modules/errors/fault.domain';
import { OzonAuthError } from '../../src/modules/ozon/ozon.errors';
import { WbApiError } from '../../src/modules/wb/wb.errors';
import { ReportGenerationError } from '../../src/modules/yandex/report-generation.error';
import { YandexApiError } from '../../src/modules/yandex/yandex-api.errors';

/** Ошибка Telegram так, как её отдаёт telegraf: код в `response.error_code`. */
const telegram = (code: number) =>
  Object.assign(new Error(`${code}: tg`), { response: { error_code: code, description: 'tg' } });

/**
 * Сторона сбоя в алерте. 13-11-2026 провал отчёта FBY выглядел нашей поломкой,
 * хотя ронял его сам Маркет: класс ошибки и код ответа решают это сразу.
 */
describe('faultOf', () => {
  it.each([
    [
      'Маркет провалил отчёт',
      new ReportGenerationError('x', 'r', { status: 'FAILED' }, 1),
      { side: 'external', party: 'Яндекс Маркет', reason: 'провалил отчёт сам' },
    ],
    [
      'провал отчёта с subStatus',
      new ReportGenerationError('x', 'r', { status: 'FAILED', subStatus: 'TOO_LARGE' }, 1),
      { side: 'external', reason: 'провалил отчёт сам: TOO_LARGE' },
    ],
    [
      'отчёт не готов к потолку',
      new ReportGenerationError('x', 'r', { status: 'PENDING' }, 1),
      { side: 'external', party: 'Яндекс Маркет' },
    ],
    [
      'Маркет не ответил',
      new YandexApiError('x', 0),
      { side: 'external', reason: 'нет ответа (сеть)' },
    ],
    [
      'Маркет 500',
      new YandexApiError('x', 500),
      { side: 'external', reason: 'ошибка сервера 500' },
    ],
    ['Маркет 420', new YandexApiError('x', 420), { side: 'external', reason: 'лимит запросов' }],
    ['токен продавца 401', new YandexApiError('x', 401), { side: 'seller' }],
    [
      'наш запрос 400',
      new YandexApiError('x', 400),
      { side: 'ours', reason: 'Яндекс Маркет не принял наш запрос (400)' },
    ],
    ['ключ Ozon продавца', new OzonAuthError('x', 403), { side: 'seller' }],
    ['WB 503', new WbApiError('x', 503), { side: 'external', party: 'Wildberries' }],
    ['ключ Polza — наш', new PolzaApiError('x', 401), { side: 'ours' }],
    [
      'баланс Polza — наш',
      new PolzaInsufficientFundsError('x', 402),
      { side: 'ours', reason: 'кончились деньги на Polza' },
    ],
    ['Telegram 502', telegram(502), { side: 'external', party: 'Telegram' }],
    ['бот заблокирован', telegram(403), { side: 'seller' }],
    ['Telegram 429 — шлём часто мы', telegram(429), { side: 'ours' }],
    ['Telegram 400', telegram(400), { side: 'ours' }],
    [
      'Postgres',
      new DrizzleQueryError('select 1', [], new Error('timeout')),
      { side: 'ours', reason: 'база данных (Postgres)' },
    ],
    [
      'Mongo',
      Object.assign(new Error('x'), { name: 'MongoServerSelectionError' }),
      { side: 'ours', reason: 'база данных (Mongo)' },
    ],
    [
      'сеть без площадки',
      Object.assign(new Error('x'), { code: 'ECONNRESET' }),
      { side: 'unknown', reason: 'сеть (ECONNRESET)' },
    ],
    ['наш код', new TypeError('x is undefined'), { side: 'ours', reason: 'ошибка в коде' }],
    ['не Error', 'строка', { side: 'unknown' }],
  ])('%s', (_name, error, expected) => {
    expect(faultOf(error)).toMatchObject(expected);
  });
});

describe('faultLine', () => {
  it('внешняя сторона — с именем площадки', () => {
    expect(faultLine({ side: 'external', party: 'Ozon', reason: 'лимит запросов' })).toBe(
      'Сторона: 🌐 Ozon — лимит запросов',
    );
  });

  it('без причины — без тире', () => {
    expect(faultLine({ side: 'unknown' })).toBe('Сторона: ❔ не определена');
  });
});
