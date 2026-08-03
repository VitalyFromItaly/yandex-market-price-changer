import { describe, it, expect } from 'vitest';

import {
  FBY_STOCKS_READONLY,
  PLACEMENT,
  PLACEMENT_UNKNOWN,
  isStockWritable,
  placementOfCampaign,
} from '../../src/modules/yandex/stocks/placement';

/**
 * Правило «на FBY остатки только читаются».
 *
 * Проверяется юнит-тестами по той же причине, что и реестр возможностей: ошибка
 * здесь не даёт ни ошибки компиляции, ни падения в рантайме. Модуль просто
 * начинает разрешать запись туда, где остатками распоряжается Маркет, — а узнать
 * об этом можно будет только по расхождению остатков у живого продавца.
 */
describe('Модель размещения и право писать остатки', () => {
  it('склады продавца — писать можно', () => {
    expect(isStockWritable(PLACEMENT.FBS)).toBe(true);
    expect(isStockWritable(PLACEMENT.DBS)).toBe(true);
    expect(isStockWritable(PLACEMENT.EXPRESS)).toBe(true);
  });

  it('FBY — нельзя: там распоряжается Маркет', () => {
    expect(isStockWritable(PLACEMENT.FBY)).toBe(false);
  });

  it('неизвестная модель считается запрещённой, а не разрешённой', () => {
    // Несправедливый отказ чинится сменой магазина за два нажатия, а лишняя
    // запись на склад Маркета не чинится ничем.
    expect(isStockWritable(undefined)).toBe(false);
    expect(isStockWritable(null)).toBe(false);
    expect(isStockWritable('')).toBe(false);
    expect(isStockWritable('LAAS')).toBe(false);
    expect(isStockWritable('нечто')).toBe(false);
  });

  it('регистр и пробелы не влияют — Маркет отдаёт строку, а не член союза', () => {
    expect(isStockWritable('fbs')).toBe(true);
    expect(isStockWritable(' FbS ')).toBe(true);
    expect(isStockWritable('fby')).toBe(false);
  });
});

describe('placementOfCampaign', () => {
  const STORES = [
    { campaignId: '124425371', placementType: 'FBS' },
    { campaignId: '148655119', placementType: 'FBS' },
    { campaignId: '148704883', placementType: 'FBY' },
  ];

  it('ищет по campaignId, а не берёт первую', () => {
    // У живого продавца один токен открывает три FBS и одну FBY. Взять первую
    // значило бы решать судьбу записи по чужому магазину.
    expect(placementOfCampaign(STORES, '148704883')).toBe('FBY');
    expect(placementOfCampaign(STORES, '148655119')).toBe('FBS');
  });

  it('пустой кэш и неизвестная кампания — «не знаем»', () => {
    expect(placementOfCampaign(undefined, '1')).toBeUndefined();
    expect(placementOfCampaign([], '1')).toBeUndefined();
    expect(placementOfCampaign(STORES, 'нет такой')).toBeUndefined();
    expect(placementOfCampaign(STORES, undefined)).toBeUndefined();
  });

  it('«не знаем» через isStockWritable превращается в запрет', () => {
    // Связка двух функций и есть правило: placementOfCampaign не решает сама.
    expect(isStockWritable(placementOfCampaign([], '1'))).toBe(false);
  });

  it('модель без placementType не выдаётся за разрешение', () => {
    const stores = [{ campaignId: '1' }];
    expect(placementOfCampaign(stores, '1')).toBeUndefined();
    expect(isStockWritable(placementOfCampaign(stores, '1'))).toBe(false);
  });
});

describe('Текст предупреждения на FBY', () => {
  it('называет модель и ведёт к смене магазина, а не к повторной отправке файла', () => {
    expect(FBY_STOCKS_READONLY).toContain('FBY');
    expect(FBY_STOCKS_READONLY).toContain('Сменить магазин');
    // Совет «пришлите ещё раз без пометки проверка» здесь был бы предложением
    // сделать то, что снова не сработает.
    expect(FBY_STOCKS_READONLY).not.toContain('проверка');
  });

  it('обещает разобрать файл и сохранить закуп — это не отказ в приёме', () => {
    // Файл принимается ради закупочных цен: без них «Прибыль» у FBY-продавца не
    // считается вовсе. Текст, обещающий отказ, противоречил бы поведению.
    expect(FBY_STOCKS_READONLY.toLowerCase()).toContain('закупочные цены');
    expect(FBY_STOCKS_READONLY).toContain('Прибыль');
    expect(PLACEMENT_UNKNOWN.toLowerCase()).toContain('закупочные цены');
  });
});
