import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import { formatReport } from '../../src/modules/yandex/reports/report-message';
import { NBSP } from '../../src/modules/yandex/reports/money';

const NOW = new Date('2026-07-29T10:00:00Z');
const STORE = { token: 'ACMA:x', campaign_id: '1', business_id: '2' } as never;

/** Клиент-заглушка: отдаёт заранее заданные заказы и возвраты. */
function buildService(opts: { orders?: unknown[]; returns?: unknown[] } = {}) {
  const queries: Record<string, unknown>[] = [];
  const returnQueries: Record<string, unknown>[] = [];

  const client = {
    async *iterateOrders(query: Record<string, unknown>) {
      queries.push(query);
      if (opts.orders?.length) yield opts.orders;
    },
    async *iterateReturns(query: Record<string, unknown>) {
      returnQueries.push(query);
      if (opts.returns?.length) yield opts.returns;
    },
  };

  const factory = { forStore: vi.fn(() => client) };

  return { factory, queries, returnQueries };
}

async function service(opts: Parameters<typeof buildService>[0] = {}) {
  const { factory, queries, returnQueries } = buildService(opts);
  const moduleRef = await Test.createTestingModule({
    providers: [
      OrderReportsService,
      { provide: YandexClientFactory, useValue: factory },
    ],
  }).compile();
  return {
    reports: moduleRef.get(OrderReportsService),
    queries,
    returnQueries,
    factory,
  };
}

describe('Отчёт «уехало клиенту» (TASK-023)', () => {
  it('фильтрует по дате ОТГРУЗКИ, а не по дате создания', async () => {
    // Заказ мог быть создан неделю назад, а уехать сегодня.
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);

    expect(queries[0].supplierShipmentDateFrom).toBe('29-07-2026');
    expect(queries[0].supplierShipmentDateTo).toBe('29-07-2026');
    expect(queries[0]).not.toHaveProperty('fromDate');
    expect(queries[0].status).toEqual(['DELIVERY']);
  });

  it('считает количество и обе суммы', async () => {
    const { reports } = await service({
      orders: [
        { id: 1, status: 'DELIVERY', itemsTotal: 1000, deliveryTotal: 100 },
        { id: 2, status: 'DELIVERY', itemsTotal: 500, deliveryTotal: 50 },
      ],
    });

    const result = await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);

    expect(result.count).toBe(2);
    expect(result.totals).toEqual({ items: 1500, withDelivery: 1650 });
  });

  it('заказы не того статуса отсеиваются даже если пришли в ответе', async () => {
    const { reports } = await service({
      orders: [
        { id: 1, status: 'DELIVERY', itemsTotal: 100 },
        { id: 2, status: 'CANCELLED', itemsTotal: 999 },
      ],
    });

    const result = await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);
    expect(result.count).toBe(1);
    expect(result.totals.items).toBe(100);
  });
});

describe('Отчёт «выкуплено» (TASK-024)', () => {
  it('фильтрует по updatedAt в ISO со смещением', async () => {
    // Без смещения Яндекс истолкует время как UTC и отчёт сдвинется на 3 часа.
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.REDEEMED, NOW);

    expect(queries[0].updatedAtFrom).toBe('2026-07-29T00:00:00+03:00');
    expect(queries[0].updatedAtTo).toBe('2026-07-29T23:59:59+03:00');
    expect(queries[0].status).toEqual(['DELIVERED']);
  });

  it('диапазон укладывается в сутки, то есть заведомо в 30-дневный лимит', async () => {
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.REDEEMED, NOW);

    const from = new Date(queries[0].updatedAtFrom as string);
    const to = new Date(queries[0].updatedAtTo as string);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    expect(days).toBeLessThan(1);
  });
});

describe('Отчёт «едет обратно» (TASK-025)', () => {
  it('заказ с подстатусом-опечаткой не теряется', async () => {
    const { reports } = await service({
      orders: [
        { id: 1, status: 'DELIVERY', substatus: 'DELIVERY_SERIVCE_UNDELIVERED', itemsTotal: 700 },
        { id: 2, status: 'DELIVERY', substatus: 'DELIVERY_SERVICE_UNDELIVERED', itemsTotal: 300 },
      ],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);
    expect(result.count).toBe(2);
    expect(result.totals.items).toBe(1000);
  });

  it('обычная доставка без возвратного подстатуса в отчёт не попадает', async () => {
    // Фильтр по статусу уходит в запрос, но подстатус Partner API отбирать не
    // умеет — без проверки поверх ответа сюда попали бы все заказы в доставке.
    const { reports } = await service({
      orders: [
        { id: 1, status: 'DELIVERY', substatus: 'DELIVERY_SERVICE_RECEIVED', itemsTotal: 999 },
        { id: 2, status: 'DELIVERY', substatus: 'FULL_NOT_RANSOM', itemsTotal: 100 },
      ],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);
    expect(result.count).toBe(1);
    expect(result.totals.items).toBe(100);
  });

  it('возвраты берутся со статусом отгрузки «в пути»', async () => {
    const { reports, returnQueries } = await service();
    await reports.build(STORE, REPORT.RETURNING, NOW);

    expect(returnQueries[0].shipmentStatuses).toEqual(['IN_TRANSIT']);
  });

  it('заказ из ОБОИХ источников считается один раз', async () => {
    // Невыкуп приходит и заказом с подстатусом, и записью в методе возвратов.
    const { reports } = await service({
      orders: [{ id: 42, status: 'DELIVERY', substatus: 'FULL_NOT_RANSOM', itemsTotal: 500 }],
      returns: [{ returnId: 7, orderId: 42, amount: { value: 500, currencyId: 'RUR' } }],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);

    expect(result.count).toBe(1);
    expect(result.totals.items).toBe(500);
  });

  it('возврат без соответствующего заказа добавляется к отчёту', async () => {
    const { reports } = await service({
      orders: [{ id: 42, status: 'DELIVERY', substatus: 'FULL_NOT_RANSOM', itemsTotal: 500 }],
      returns: [{ returnId: 7, orderId: 99, amount: { value: 300, currencyId: 'RUR' } }],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);

    expect(result.count).toBe(2);
    expect(result.totals.items).toBe(800);
  });

  it('дубли внутри самого списка возвратов тоже схлопываются', async () => {
    const { reports } = await service({
      returns: [
        { returnId: 1, orderId: 5, amount: { value: 100 } },
        { returnId: 2, orderId: 5, amount: { value: 100 } },
      ],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);
    expect(result.count).toBe(1);
  });
});

describe('Отчёт «едет до клиента» (TASK-026)', () => {
  it('берёт три статуса и НЕ ставит фильтр даты', async () => {
    // Это срез «что сейчас в пути», а не события за период.
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.IN_TRANSIT, NOW);

    expect(queries[0].status).toEqual(['PROCESSING', 'DELIVERY', 'PICKUP']);
    expect(queries[0]).not.toHaveProperty('updatedAtFrom');
    expect(queries[0]).not.toHaveProperty('supplierShipmentDateFrom');
  });

  it('метод возвратов для него не вызывается', async () => {
    const { reports, returnQueries } = await service();
    await reports.build(STORE, REPORT.IN_TRANSIT, NOW);

    expect(returnQueries).toHaveLength(0);
  });
});

describe('Мультитенантность', () => {
  it('клиент создаётся под КОНКРЕТНЫЙ магазин на каждый отчёт', async () => {
    const { reports, factory } = await service();
    await reports.build(STORE, REPORT.REDEEMED, NOW);

    expect(factory.forStore).toHaveBeenCalledWith(STORE);
  });
});

describe('Текст отчёта', () => {
  it('пустой результат — понятное сообщение, а не пустая таблица', async () => {
    const { reports } = await service();
    const result = await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);

    const text = formatReport(result, NOW);
    expect(text).toContain('данных нет');
    expect(text).not.toContain('0 ₽');
  });

  it('пустой «едет обратно» звучит как отсутствие возвратов, а не как сбой', async () => {
    const { reports } = await service();
    const result = await reports.build(STORE, REPORT.RETURNING, NOW);

    expect(formatReport(result, NOW)).toContain('Возвратов и невыкупов нет');
  });

  it('непустой отчёт содержит количество и обе суммы', async () => {
    const { reports } = await service({
      orders: [{ id: 1, status: 'DELIVERED', itemsTotal: 1000, deliveryTotal: 234 }],
    });
    const result = await reports.build(STORE, REPORT.REDEEMED, NOW);

    const text = formatReport(result, NOW);
    expect(text).toContain('Заказов');
    expect(text).toContain('Товары');
    expect(text).toContain('С доставкой');
    expect(text).toContain(`1${NBSP}000${NBSP}₽`);
    expect(text).toContain(`1${NBSP}234${NBSP}₽`);
  });

  it('в отчёте за период указана дата, а в срезе «в пути» — нет', async () => {
    const { reports } = await service({
      orders: [{ id: 1, status: 'DELIVERY', itemsTotal: 1 }],
    });
    const shipped = await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);
    expect(formatReport(shipped, NOW)).toContain('29-07-2026');

    const { reports: r2 } = await service({
      orders: [{ id: 1, status: 'DELIVERY', itemsTotal: 1 }],
    });
    const inTransit = await r2.build(STORE, REPORT.IN_TRANSIT, NOW);
    expect(formatReport(inTransit, NOW)).not.toContain('29-07-2026');
  });
});
