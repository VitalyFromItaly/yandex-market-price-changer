import { describe, expect, it } from 'vitest';

import { ordersResponse } from './accountingOrders.fixtures.accounting';
import { mapAccountingOrders } from './mapAccountingOrders.accounting';

describe('mapAccountingOrders', () => {
  it('подтверждённое и ожидаемое раздельно, площадка — подписью сервера', () => {
    const [row] = mapAccountingOrders(ordersResponse()).rows;
    expect(row?.confirmedLabel).toMatch(/^200/);
    expect(row?.expectedLabel).toMatch(/50/);
    expect(row?.marketplaceLabel).toBe('Яндекс Маркет');
    expect(row?.offersLabel).toBe('Чайник, Кружка и ещё 1 · 3 шт.');
    expect(row?.stateLabel).toBe('Предварительно');
    expect(row?.stateTone).toBe('warn');
    expect(row?.dayLabel).toBe('03-10-2026');
  });

  it('неизвестная прибыль — «Неизвестно», не «0 ₽»; нулевое ожидаемое — прочерк', () => {
    const row = mapAccountingOrders(ordersResponse()).rows[1];
    expect(row?.netLabel).toBe('Неизвестно');
    expect(row?.netUnknown).toBe(true);
    expect(row?.netLabel).not.toMatch(/0/);
    expect(row?.expectedLabel).toBeNull();
    expect(row?.revenueLabel).toBe('—');
    expect(row?.marketplaceLabel).toBe('Ozon');
  });

  it('итог помечен неокончательным, пока не все заказы сверены; неизвестные — словами', () => {
    const view = mapAccountingOrders(ordersResponse());
    expect(view.totals.netTitle).toBe('Прибыль заказов (не окончательная)');
    expect(view.totals.netCaption).toBe('Без 1 заказа с неизвестной прибылью');
    expect(view.periodLabel).toBe('Октябрь 2026');
    expect(view.totals.unallocatedLabel).toBeNull();

    const reconciled = ordersResponse();
    reconciled.rows = reconciled.rows.map((r) => ({ ...r, state: 'reconciled' as const }));
    expect(mapAccountingOrders(reconciled).totals.netTitle).toBe('Прибыль заказов');
  });

  it('варианты фильтров — с сервера, нераспределённое — строкой', () => {
    const view = mapAccountingOrders(ordersResponse({ unallocatedKopecks: 12_300 }));
    expect(view.stateOptions.map((o) => o.value)).toEqual([
      'forecast',
      'preliminary',
      'reconciled',
    ]);
    expect(view.marketplaceOptions).toEqual([
      { value: 'ym', label: 'Яндекс Маркет' },
      { value: 'ozon', label: 'Ozon' },
    ]);
    expect(view.totals.unallocatedLabel).toMatch(/^Не распределено на заказы: 123/);
  });
});
