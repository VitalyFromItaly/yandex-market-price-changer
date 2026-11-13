import { describe, expect, it } from 'vitest';

import { drillResponse } from './accountingDashboard.fixtures.accounting';
import { mapAccountingDashboardDrill } from './mapAccountingDashboardDrill.accounting';

describe('mapAccountingDashboardDrill', () => {
  it('операции, суммы заказов и «показано N из M», когда сервер обрезал список', () => {
    const view = mapAccountingDashboardDrill(drillResponse());
    expect(view.title).toBe('Комиссии');
    expect(view.subtitle).toContain('Яндекс Маркет');
    expect(view.operations[0]).toMatchObject({ dayLabel: '03-11-2026', documentLabel: 'D-1' });
    expect(view.operationsNote).toBe('Показано 1 из 600');
    expect(view.orders[0]).toMatchObject({ orderId: '111', note: 'Ожидается', expected: true });
    expect(view.ordersNote).toBeNull();
    expect(view.isEmpty).toBe(false);
  });

  it('неизвестная сумма заказа — словом', () => {
    const data = drillResponse();
    data.orders = data.orders.map((o) => ({
      ...o,
      kopecks: null,
      expected: false,
      reason: 'no-record',
    }));
    data.kopecks = null;
    const view = mapAccountingDashboardDrill(data);
    expect(view.totalLabel).toBe('Неизвестно');
    expect(view.orders[0]?.amountLabel).toBe('Неизвестно');
    expect(view.orders[0]?.note).toBeTruthy();
  });
});
