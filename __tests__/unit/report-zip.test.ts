import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { unzipReportJson } from '../../src/modules/yandex/report-zip';

describe('unzipReportJson — отчёт Маркета в format=JSON', () => {
  it('ZIP с JSON на каждый лист → карта «лист → данные»', () => {
    const zip = zipSync({
      'Услуги.json': strToU8(JSON.stringify([{ ORDER_ID: 1, AMOUNT: -10.5 }])),
      'sub/Сводка.json': strToU8(JSON.stringify({ total: 3 })),
      'sub/': new Uint8Array(),
    });

    const sheets = unzipReportJson(zip);

    expect([...sheets.keys()].sort()).toEqual(['Сводка', 'Услуги']);
    expect(sheets.get('Услуги')).toEqual([{ ORDER_ID: 1, AMOUNT: -10.5 }]);
    expect(sheets.get('Сводка')).toEqual({ total: 3 });
  });

  it('не ZIP — понятная ошибка, а не пустой отчёт', () => {
    expect(() => unzipReportJson(strToU8('{"a":1}'))).toThrow(/не ZIP/);
  });

  it('битый JSON внутри — ошибка с именем листа', () => {
    const zip = zipSync({ 'Лист.json': strToU8('{oops') });
    expect(() => unzipReportJson(zip)).toThrow(/Лист/);
  });

  it('project ужимает каждый лист сразу после разбора', () => {
    const zip = zipSync({
      'a.json': strToU8(JSON.stringify({ rows: [1, 2, 3] })),
      'b.json': strToU8(JSON.stringify({ rows: [4] })),
    });
    const seen: string[] = [];

    const sheets = unzipReportJson(zip, (sheet, data) => {
      seen.push(sheet);
      return (data as { rows: number[] }).rows.length;
    });

    expect(seen.sort()).toEqual(['a', 'b']);
    expect(sheets).toEqual(
      new Map([
        ['a', 3],
        ['b', 1],
      ]),
    );
  });
});
