import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';

import { parseFbyStockCsv } from '../../src/modules/yandex/fby/fby-stock-report';
import { buildFbyWorkbook, fbyFileName } from '../../src/modules/yandex/fby/fby-workbook';

/**
 * Выгрузка сводки FBY. Файл существует потому, что таблица SKU×склад — тысячи
 * строк и в 4096 символов сообщения не помещается ни при каком пороге, поэтому
 * проверяем главное: все три листа на месте и числа в них сходятся с отчётом.
 */
const CSV = [
  'SHOP_SKU,ARTICLE,MARKET_SKU,PRODUCT_NAME,VALID,RESERVED,AVAILABLE_FOR_ORDER,QUARANTINE,UTILIZATION,DEFECT,EXPIRED,WAREHOUSE',
  'A159W,A159W,1,Часы A159W,10,2,8,0,0,1,0,Софьино',
  'A159W,A159W,1,Часы A159W,5,0,5,0,0,0,0,Ростов-на-Дону-1',
  'MTP-V001,MTP,2,Часы MTP,3,0,3,0,0,0,0,Софьино',
  // Строка, где по всем типам ноль: в файл не попадает — она ничего не сообщает.
  'DEAD-1,DEAD,3,Снятая позиция,0,0,0,0,0,0,0,Софьино',
].join('\n');

const sheetRows = (buffer: Buffer, name: string): unknown[][] => {
  const book = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '' });
};

describe('buildFbyWorkbook', () => {
  const summary = parseFbyStockCsv(CSV);
  const { buffer, rows, truncated } = buildFbyWorkbook(summary);

  it('в книге три листа', () => {
    const book = XLSX.read(buffer, { type: 'buffer' });
    expect(book.SheetNames).toEqual([
      'Остатки по складам',
      'Позиции по складам',
      'Проблемные FBY',
    ]);
  });

  it('лист складов сходится с итогами отчёта', () => {
    const data = sheetRows(buffer, 'Остатки по складам');
    const total = data.at(-1) as (string | number)[];

    expect(total[0]).toBe('ИТОГО');
    // Первый столбец после названия — «Доступно к заказу» (порядок FBY_STOCK_TYPES).
    expect(total[1]).toBe(summary.totals.AVAILABLE);
    expect(data[1][0]).toBe('Ростов-на-Дону-1'); // склады по алфавиту
  });

  it('лист позиций несёт SKU×склад и пропускает пустые строки', () => {
    const data = sheetRows(buffer, 'Позиции по складам');

    expect(data[0]).toEqual([
      'SKU',
      'Название',
      'Склад',
      'Доступно к заказу',
      'Годный',
      'Резерв',
      'Карантин',
      'Брак',
      'Просрочка',
      'К утилизации',
    ]);
    // Три непустые строки CSV, снятая позиция отброшена.
    expect(data).toHaveLength(4);
    expect(rows).toBe(3);
    expect(truncated).toBe(0);
    expect(data.map((r) => r[2]).slice(1)).toEqual(['Софьино', 'Ростов-на-Дону-1', 'Софьино']);
  });

  it('лист проблемных сохраняет прежние колонки', () => {
    const data = sheetRows(buffer, 'Проблемные FBY');
    expect(data[0]).toEqual(['SKU', 'Название', 'Брак', 'Просрочка', 'К утилизации']);
    expect(data[1][0]).toBe('A159W');
  });

  it('имя файла несёт дату и время — как у выгрузок заказов', () => {
    expect(fbyFileName('05-08-2026', '14:12')).toBe('fby-ostatki-05-08-2026-1412.xlsx');
  });
});
