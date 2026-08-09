import { describe, it, expect } from 'vitest';

import {
  parsePqCallback,
  parseQuarantineOffer,
  PQ_CB_ALL,
  pqConfirmCallback,
} from '../../src/modules/yandex/quarantine/quarantine.domain';

/**
 * Разбор ответа карантина и кодек кнопок.
 *
 * Цены обязаны читаться из `verdicts.params` — deprecated-поля
 * `currentPrice`/`lastValidPrice` спека велит не использовать, и тест
 * закрепляет, что разбор на них не опирается.
 */
describe('Карантин: разбор ответа', () => {
  it('цены читаются из params, а не из deprecated-полей товара', () => {
    const offer = parseQuarantineOffer({
      offerId: 'Casio GA-2100',
      verdicts: [
        {
          type: 'PRICE_CHANGE',
          params: [
            { name: 'CURRENT_PRICE', value: '990' },
            { name: 'LAST_VALID_PRICE', value: '9900' },
            { name: 'CURRENCY', value: 'RUR' },
          ],
        },
      ],
    });

    expect(offer).not.toBeNull();
    expect(offer.verdicts[0]).toMatchObject({
      type: 'PRICE_CHANGE',
      currentPrice: 990,
      lastValidPrice: 9900,
    });
    expect(offer.verdicts[0].minPrice).toBeUndefined();
  });

  it('LOW_PRICE несёт порог MIN_PRICE', () => {
    const offer = parseQuarantineOffer({
      offerId: 'X',
      verdicts: [
        {
          type: 'LOW_PRICE',
          params: [
            { name: 'CURRENT_PRICE', value: '500' },
            { name: 'MIN_PRICE', value: '1200' },
          ],
        },
      ],
    });

    expect(offer.verdicts[0]).toMatchObject({ currentPrice: 500, minPrice: 1200 });
  });

  it('без артикула товар отбрасывается — показывать нечего', () => {
    expect(parseQuarantineOffer({ verdicts: [] })).toBeNull();
    expect(parseQuarantineOffer({} as never)).toBeNull();
  });

  it('битая цена не превращается в число', () => {
    const offer = parseQuarantineOffer({
      offerId: 'X',
      verdicts: [{ type: 'LOW_PRICE', params: [{ name: 'CURRENT_PRICE', value: 'мусор' }] }],
    });
    expect(offer.verdicts[0].currentPrice).toBeUndefined();
  });

  it('неизвестный тип вердикта сохраняется как есть — на боевом набор шире спеки', () => {
    const offer = parseQuarantineOffer({
      offerId: 'X',
      verdicts: [{ type: 'NEW_VERDICT', params: [] }],
    });
    expect(offer.verdicts[0].type).toBe('NEW_VERDICT');
  });
});

describe('Карантин: кодек кнопок', () => {
  it('подтверждение одного товара несёт индекс', () => {
    expect(pqConfirmCallback(3)).toBe('pq:ok:3');
    expect(parsePqCallback('pq:ok:3')).toEqual({ action: 'ok', index: 3 });
  });

  it('«подтвердить все» — без индекса', () => {
    expect(parsePqCallback(PQ_CB_ALL)).toEqual({ action: 'all' });
  });

  it('мусор не разбирается', () => {
    expect(parsePqCallback('pq:ok:')).toBeNull();
    expect(parsePqCallback('pq:xxx')).toBeNull();
    expect(parsePqCallback('rep:month:profit')).toBeNull();
    expect(parsePqCallback(undefined)).toBeNull();
  });
});
