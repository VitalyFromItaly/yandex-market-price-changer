import { describe, it, expect } from 'vitest';

import { parseFbyStockCsv, problemTotal } from '../../src/modules/yandex/fby/fby-stock-report';

/**
 * Агрегация отчёта «Остатки на складах» (FBY). Проверяем на инлайновом CSV —
 * той же плоской таблице SKU×склад, что отдаёт Маркет. Распаковка ZIP проверена
 * отдельно живым прогоном на реальном файле; здесь — вся содержательная логика.
 *
 * Колонки как в боевом CSV: VALID=годный(FIT), RESERVED=резерв(FREEZE),
 * AVAILABLE_FOR_ORDER=доступно(AVAILABLE), QUARANTINE, UTILIZATION, DEFECT, EXPIRED.
 */
const HEADER =
  'SHOP_SKU,ARTICLE,MARKET_SKU,PRODUCT_NAME,VALID,RESERVED,AVAILABLE_FOR_ORDER,QUARANTINE,UTILIZATION,DEFECT,EXPIRED,WAREHOUSE';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('parseFbyStockCsv', () => {
  it('суммирует остатки по типам по всем строкам и складам', () => {
    const summary = parseFbyStockCsv(
      csv(
        'A1,A1,1,Часы A1,3,1,2,0,0,0,0,Софьино',
        'A1,A1,1,Часы A1,0,0,0,0,0,0,0,Екатеринбург',
        'B2,B2,2,Часы B2,5,0,4,1,0,0,0,Софьино',
      ),
    );

    expect(summary.totals.FIT).toBe(8); // 3 + 5
    expect(summary.totals.FREEZE).toBe(1);
    expect(summary.totals.AVAILABLE).toBe(6); // 2 + 4
    expect(summary.totals.QUARANTINE).toBe(1);
    expect(summary.totals.DEFECT).toBe(0);
  });

  it('собирает проблемные позиции и суммирует брак/просрочку/утиль одного SKU по складам', () => {
    const summary = parseFbyStockCsv(
      csv(
        'A1,A1,1,Часы A1,0,0,0,0,0,1,0,Домодедово возвратный',
        'A1,A1,1,Часы A1,0,0,0,0,0,2,1,Софьино',
        'GOOD,GOOD,9,Часы GOOD,10,0,10,0,0,0,0,Софьино',
      ),
    );

    expect(summary.problems).toHaveLength(1); // только A1, GOOD не проблемный
    const a1 = summary.problems[0];
    expect(a1.sku).toBe('A1');
    expect(a1.defect).toBe(3); // 1 + 2
    expect(a1.expired).toBe(1);
    expect(a1.utilization).toBe(0);
    expect(problemTotal(a1)).toBe(4);
  });

  it('проблемные отсортированы по убыванию суммы проблем', () => {
    const summary = parseFbyStockCsv(
      csv('SMALL,SMALL,1,Часы,0,0,0,0,0,1,0,Софьино', 'BIG,BIG,2,Часы,0,0,0,0,5,0,0,Софьино'),
    );

    expect(summary.problems.map((p) => p.sku)).toEqual(['BIG', 'SMALL']);
  });

  it('пустые ячейки количества считаются нулём, а не ломают агрегат', () => {
    const summary = parseFbyStockCsv(csv('A1,A1,1,Часы A1,,,,,,,,Софьино'));
    expect(summary.totals.FIT).toBe(0);
    expect(summary.problems).toHaveLength(0);
  });

  it('нет проблемных — пустой список, а не падение', () => {
    const summary = parseFbyStockCsv(csv('A1,A1,1,Часы A1,3,0,3,0,0,0,0,Софьино'));
    expect(summary.problems).toEqual([]);
  });

  it('запятая в названии товара не сдвигает колонки (CSV с кавычками)', () => {
    const summary = parseFbyStockCsv(csv('A1,A1,1,"Часы CASIO, стальные",0,0,0,0,0,4,0,Софьино'));
    expect(summary.problems).toHaveLength(1);
    expect(summary.problems[0].name).toBe('Часы CASIO, стальные');
    expect(summary.problems[0].defect).toBe(4);
  });

  it('копит остатки по складам: строки одного склада складываются, разные — раздельно', () => {
    const summary = parseFbyStockCsv(
      csv(
        'A1,A1,1,Часы A1,3,1,2,0,0,0,0,Софьино',
        'B2,B2,2,Часы B2,5,0,4,1,0,0,0,Софьино',
        'A1,A1,1,Часы A1,7,0,6,0,0,0,0,Екатеринбург',
      ),
    );

    expect(summary.byWarehouse['Софьино'].FIT).toBe(8); // 3 + 5
    expect(summary.byWarehouse['Софьино'].AVAILABLE).toBe(6); // 2 + 4
    expect(summary.byWarehouse['Екатеринбург'].FIT).toBe(7);
    expect(summary.byWarehouse['Екатеринбург'].QUARANTINE).toBe(0);
  });

  it('сумма по складам сходится с общими итогами — по построению', () => {
    const summary = parseFbyStockCsv(
      csv('A1,A1,1,Часы A1,3,1,2,0,0,1,0,Софьино', 'B2,B2,2,Часы B2,5,0,4,1,2,0,3,Екатеринбург'),
    );

    const warehouses = Object.values(summary.byWarehouse);
    for (const type of ['FIT', 'FREEZE', 'AVAILABLE', 'QUARANTINE', 'DEFECT', 'EXPIRED'] as const) {
      const sum = warehouses.reduce((acc, totals) => acc + totals[type], 0);
      expect(sum).toBe(summary.totals[type]);
    }
  });

  it('строка без названия склада копится под пустым ключом, а не выбрасывается', () => {
    // Иначе сумма по складам разошлась бы с totals — молча.
    const summary = parseFbyStockCsv(csv('A1,A1,1,Часы A1,3,0,3,0,0,0,0,'));
    expect(summary.byWarehouse[''].FIT).toBe(3);
    expect(summary.totals.FIT).toBe(3);
  });
});
