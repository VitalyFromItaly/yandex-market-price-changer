import { describe, it, expect } from 'vitest';

import type { IWarehouseInfo } from '../../src/modules/yandex/yandex-api.client';
import type { TFbyStockType } from '../../src/modules/yandex/fby/fby-stock-report';

import { FBY_STOCK_TYPES } from '../../src/modules/yandex/fby/fby-stock-report';
import {
  joinWarehouseStock,
  stockTotal,
  warehouseKey,
  UNNAMED_WAREHOUSE,
} from '../../src/modules/yandex/warehouses/warehouse-stock';

/**
 * Соединение списка складов Маркета с остатками из отчёта. Общего идентификатора
 * у источников нет — только имя, — поэтому проверяем и нормализацию, и то, что
 * ни одна запись отчёта не теряется и не считается дважды.
 */
describe('warehouseKey', () => {
  it('нормализует то, чем два источника Маркета расходятся', () => {
    expect(warehouseKey('Толмачёво')).toBe(warehouseKey('толмачево'));
    expect(warehouseKey('  Софьино  ')).toBe('софьино');
    expect(warehouseKey('Белые Столбы')).toBe('белые столбы');
    expect(warehouseKey('Склад  «Юг»')).toBe('склад юг');
    expect(warehouseKey('Ростов–на–Дону')).toBe('ростов-на-дону');
  });

  it('цифры и суффиксы не трогает — ими площадки и различаются', () => {
    expect(warehouseKey('Ростов-на-Дону-1')).not.toBe(warehouseKey('Ростов-на-Дону-2'));
  });
});

describe('joinWarehouseStock', () => {
  const fby = (id: number, name: string, address?: string): IWarehouseInfo => ({
    id,
    name,
    type: 'fby',
    address,
  });

  const stock = (values: Partial<Record<TFbyStockType, number>>) => {
    const totals = {} as Record<TFbyStockType, number>;
    for (const type of FBY_STOCK_TYPES) totals[type] = values[type] ?? 0;
    return totals;
  };

  it('склад из списка и запись отчёта соединяются по имени, а не по id', () => {
    const [row] = joinWarehouseStock([fby(100, 'Софьино', 'Москва')], {
      'софьино ': stock({ AVAILABLE: 5 }),
    });

    expect(row.origin).toBe('matched');
    expect(row.ids).toEqual([100]);
    expect(row.address).toBe('Москва');
    expect(row.count).toBe(5);
  });

  it('склад только в списке — пуст, а не «неизвестен», когда отчёт есть', () => {
    const [row] = joinWarehouseStock([fby(147, 'Ростов-на-Дону-1')], {});

    expect(row.origin).toBe('list-only');
    expect(row.totals).not.toBeNull();
    expect(row.count).toBe(0);
  });

  it('отчёта нет вовсе — остатки null у всех строк', () => {
    const rows = joinWarehouseStock([fby(147, 'Ростов-на-Дону-1')], null);

    expect(rows).toHaveLength(1);
    expect(rows[0].totals).toBeNull();
  });

  it('склад только в отчёте показывается своим именем и без id', () => {
    const rows = joinWarehouseStock([], { 'Новая площадка': stock({ AVAILABLE: 12 }) });

    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('report-only');
    expect(rows[0].name).toBe('Новая площадка');
    expect(rows[0].ids).toEqual([]);
  });

  it('строки отчёта без склада — «склад без названия», и только если там что-то есть', () => {
    const withStock = joinWarehouseStock([], { '': stock({ DEFECT: 3 }) });
    expect(withStock[0].name).toBe(UNNAMED_WAREHOUSE);

    // Нулевой артефакт показывать нечего, и сумму он не меняет.
    expect(joinWarehouseStock([], { '': stock({}) })).toEqual([]);
  });

  it('одноимённые склады списка дают ОДНУ строку — иначе двойной счёт', () => {
    const rows = joinWarehouseStock([fby(1, 'Склад'), fby(2, 'склад')], {
      Склад: stock({ AVAILABLE: 10 }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].ids).toEqual([1, 2]);
    expect(rows[0].count).toBe(10);
  });

  it('сумма строк равна сумме отчёта — ничего не потеряно и не задвоено', () => {
    const byWarehouse = {
      Софьино: stock({ AVAILABLE: 1234, FREEZE: 12 }),
      'Ростов-на-Дону-1': stock({ AVAILABLE: 300 }),
      'Новая площадка': stock({ DEFECT: 7 }),
      '': stock({ AVAILABLE: 4 }),
    };
    const rows = joinWarehouseStock([fby(100, 'Софьино'), fby(147, 'Внуково')], byWarehouse);

    const shown = rows.reduce((sum, row) => sum + row.count, 0);
    const reported = Object.values(byWarehouse).reduce((sum, t) => sum + stockTotal(t), 0);
    expect(shown).toBe(reported);
  });

  it('сперва непустые по убыванию, пустые — в конце по алфавиту', () => {
    const rows = joinWarehouseStock([fby(1, 'Яуза'), fby(2, 'Внуково'), fby(3, 'Софьино')], {
      Софьино: stock({ AVAILABLE: 10 }),
      Внуково: stock({ AVAILABLE: 50 }),
    });

    expect(rows.map((r) => r.name)).toEqual(['Внуково', 'Софьино', 'Яуза']);
  });
});
