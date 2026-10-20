import { describe, expect, it } from 'vitest';

import {
  checkedLabel,
  mapConnectionCards,
  mapConnectionCheck,
  mapMarketplaces,
  mapOzonConnection,
  mapTokenReplaced,
  tokenReplacedText,
} from './mapMarketplaces.marketplaces';

const item = {
  key: 'ym',
  label: 'Яндекс Маркет',
  connected: true,
  status: 'ok',
  accountCount: 2,
  available: true,
};

describe('mapMarketplaces', () => {
  it('известные площадки — как пришли', () => {
    expect(mapMarketplaces({ marketplaces: [item] })).toEqual([item]);
  });

  it('незнакомая сборке площадка не показывается — ей некуда вести', () => {
    expect(mapMarketplaces({ marketplaces: [{ ...item, key: 'amazon' }] })).toEqual([]);
  });

  it('незнакомый статус — none, а не «подключена»', () => {
    const [mapped] = mapMarketplaces({
      marketplaces: [{ ...item, key: 'ozon', status: 'weird', connected: false }],
    });
    expect(mapped?.status).toBe('none');
  });
});

describe('mapOzonConnection', () => {
  it('ответ подключения — та же строка, что в списке', () => {
    const ozon = { ...item, key: 'ozon', label: 'Ozon', accountCount: 1 };
    expect(mapOzonConnection({ connection: ozon })).toEqual(ozon);
    expect(mapOzonConnection({ connection: { ...item, key: 'amazon' } })).toBeNull();
  });
});

const card = {
  ...item,
  keyHint: '••••1234',
  checkedAt: '2026-10-18T08:00:00.000Z',
  checkError: null,
  accounts: ['All Best Watch · FBS'],
};

describe('mapConnectionCards', () => {
  it('дата — Date, битая — null; незнакомая площадка отброшена', () => {
    const [ym, broken] = mapConnectionCards({
      connections: [card, { ...card, key: 'ozon', checkedAt: 'нет' }, { ...card, key: 'amazon' }],
    });
    expect(ym?.checkedAt?.toISOString()).toBe('2026-10-18T08:00:00.000Z');
    expect(ym?.accounts).toEqual(['All Best Watch · FBS']);
    expect(broken?.checkedAt).toBeNull();
  });
});

describe('mapConnectionCheck', () => {
  it('незнакомый итог — «не проверено», а не «связь есть»', () => {
    const result = mapConnectionCheck({ connection: card, check: { status: '???', message: 'x' } });
    expect(result.check.status).toBe('unavailable');
    expect(result.connection?.key).toBe('ym');
  });
});

describe('checkedLabel', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');
  const [ym] = mapConnectionCards({ connections: [card] });

  it('сегодня — время, ЯМ без даты — «при подключении в боте», нет ключа — ничего', () => {
    if (!ym) throw new Error('нет карточки');
    expect(checkedLabel(ym, now)).toBe('проверен 11:00');
    expect(checkedLabel({ ...ym, checkedAt: null }, now)).toBe('проверен при подключении в боте');
    expect(checkedLabel({ ...ym, key: 'ozon', checkedAt: null }, now)).toBe('ещё не проверялся');
    expect(checkedLabel({ ...ym, checkedAt: null, connected: false }, now)).toBeNull();
  });
});

describe('tokenReplacedText', () => {
  it('говорит, только если в боте сменился магазин', () => {
    expect(tokenReplacedText(mapTokenReplaced({ stores: [], botStore: null }))).toBe(
      'Список магазинов обновлён.',
    );
    expect(
      tokenReplacedText(mapTokenReplaced({ stores: [{}], botStore: 'other.ru · FBS' })),
    ).toContain('в боте активным стал «other.ru · FBS»');
  });
});
