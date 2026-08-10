import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';

import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { orderTotals, subsidiesTotal } from '../../src/modules/yandex/reports/money';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';
import { ORDER_STATUS, REPORT } from '../../src/modules/yandex/reports/report-status-map';
import {
  STATS_STATUS_TO_ORDER,
  statsCreationParams,
  statsOrderToReportOrder,
  statsUpdateParams,
  toStatsStatuses,
} from '../../src/modules/yandex/reports/stats-orders';

/**
 * Маппер архива (stats/orders) — сердце фичи deep_history: ошибка здесь даёт
 * правдоподобно неверные ДЕНЬГИ, а не падение. Фикстура повторяет живую форму
 * OrdersStatsOrderDTO: доставка отдельной позицией, count > 1, субсидии двух
 * типов в позиционных ценах.
 */
const STATS_ORDER = {
  id: 777,
  status: 'DELIVERED',
  creationDate: '2026-06-15',
  items: [
    {
      shopSku: 'TQ-141-1D',
      offerName: 'Часы Casio TQ-141-1D',
      count: 2,
      prices: [
        { type: 'BUYER', costPerItem: 1500, total: 3000 },
        { type: 'CASHBACK', costPerItem: 100, total: 200 },
        { type: 'MARKETPLACE', costPerItem: 250, total: 500 },
      ],
    },
    {
      shopSku: 'DELIVERY',
      offerName: 'Доставка',
      count: 1,
      prices: [{ type: 'BUYER', costPerItem: 99, total: 99 }],
    },
  ],
};

describe('Маппер архивного заказа', () => {
  it('деньги совпадают с эталонной формой getOrders', () => {
    const mapped = statsOrderToReportOrder(STATS_ORDER);

    // Эталон — как тот же заказ пришёл бы из getOrders.
    const reference = {
      itemsTotal: 3000,
      deliveryTotal: 99,
      subsidies: [
        { type: 'YANDEX_CASHBACK', amount: 200 },
        { type: 'SUBSIDY', amount: 500 },
      ],
    };

    expect(orderTotals(mapped)).toEqual(orderTotals(reference));
    expect(subsidiesTotal(mapped)).toBe(subsidiesTotal(reference));
    expect(subsidiesTotal(mapped)).toBe(700);
  });

  it('«Доставка» уходит в deliveryTotal и НЕ попадает в позиции', () => {
    const mapped = statsOrderToReportOrder(STATS_ORDER);
    expect(mapped.deliveryTotal).toBe(99);
    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0]).toMatchObject({
      offerId: 'TQ-141-1D',
      count: 2,
      price: 1500,
    });
  });

  it('без позиционного total сумма достраивается из costPerItem × count', () => {
    const mapped = statsOrderToReportOrder({
      id: 1,
      status: 'DELIVERED',
      items: [
        { shopSku: 'X', offerName: 'X', count: 3, prices: [{ type: 'BUYER', costPerItem: 100 }] },
      ],
    });
    expect(mapped.itemsTotal).toBe(300);
  });

  it('статусы: CANCELLED_* сливаются, PARTIALLY_DELIVERED уходит ВНИЗ', () => {
    for (const status of [
      'CANCELLED_BEFORE_PROCESSING',
      'CANCELLED_IN_DELIVERY',
      'CANCELLED_IN_PROCESSING',
    ]) {
      expect(statsOrderToReportOrder({ id: 1, status }).status).toBe(ORDER_STATUS.CANCELLED);
    }
    // Частично довезённый НЕ зачитывается выкупленным: деньги занижаем, не
    // завышаем.
    expect(statsOrderToReportOrder({ id: 1, status: 'PARTIALLY_DELIVERED' }).status).toBe(
      ORDER_STATUS.PARTIALLY_RETURNED,
    );
    expect(statsOrderToReportOrder({ id: 1, status: 'LOST' }).status).toBe(ORDER_STATUS.UNKNOWN);
  });

  it('неизвестный статус архива не превращается в DELIVERED', () => {
    expect(statsOrderToReportOrder({ id: 1, status: 'NEW_STATS_STATUS' }).status).toBe(
      ORDER_STATUS.UNKNOWN,
    );
  });

  it('каждый статус таблицы разрешается в статус заказа', () => {
    for (const mapped of Object.values(STATS_STATUS_TO_ORDER)) {
      expect(Object.values(ORDER_STATUS)).toContain(mapped);
    }
  });

  it('toStatsStatuses: DELIVERED — прямое, CANCELLED — три архивных', () => {
    expect(toStatsStatuses([ORDER_STATUS.DELIVERED])).toEqual(['DELIVERED']);
    expect(toStatsStatuses([ORDER_STATUS.CANCELLED]).sort()).toEqual([
      'CANCELLED_BEFORE_PROCESSING',
      'CANCELLED_IN_DELIVERY',
      'CANCELLED_IN_PROCESSING',
    ]);
    // PARTIALLY_RETURNED покрывает и частично довезённые.
    expect(toStatsStatuses([ORDER_STATUS.PARTIALLY_RETURNED]).sort()).toEqual([
      'PARTIALLY_DELIVERED',
      'PARTIALLY_RETURNED',
    ]);
  });

  it('границы дат: обе включительные, формат YYYY-MM-DD', () => {
    const bounds = {
      from: { year: 2026, month: 6, day: 1 },
      to: { year: 2026, month: 6, day: 30 },
    };
    expect(statsCreationParams(bounds)).toEqual({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });
    expect(statsUpdateParams(bounds)).toEqual({ updateFrom: '2026-06-01', updateTo: '2026-06-30' });
  });
});

/**
 * Роутинг collectOrders: глубокий период при включённом флаге идёт через архив,
 * свежий — через getOrders, выключенный флаг сохраняет прежний отказ.
 */
describe('Глубокая история: выбор источника', () => {
  const NOW = new Date('2026-08-08T10:00:00Z');
  const STORE = { token: 'ACMA:x', campaign_id: '1', business_id: '2' } as never;
  // 15-06-2026 — глубже 30 дней от NOW.
  const DEEP_DAY = { key: PERIOD.DAY, day: { year: 2026, month: 6, day: 15 } };

  async function service(opts: { stats?: unknown[]; orders?: unknown[] } = {}) {
    const statsQueries: Record<string, unknown>[] = [];
    const orderQueries: Record<string, unknown>[] = [];

    const client = {
      async *iterateOrders(query: Record<string, unknown>) {
        orderQueries.push(query);
        if (opts.orders?.length) yield opts.orders;
      },
      async *iterateOrdersStats(query: Record<string, unknown>) {
        statsQueries.push(query);
        if (opts.stats?.length) yield opts.stats;
      },
      async *iterateReturns() {
        // Возвраты в этих сценариях не нужны.
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderReportsService,
        { provide: YandexClientFactory, useValue: { forStore: vi.fn(() => client) } },
      ],
    }).compile();

    return { reports: moduleRef.get(OrderReportsService), statsQueries, orderQueries };
  }

  it('глубокий период + флаг → архив, обычный путь не зовётся', async () => {
    const { reports, statsQueries, orderQueries } = await service({ stats: [STATS_ORDER] });
    const result = await reports.build(STORE, REPORT.REDEEMED, NOW, DEEP_DAY, {
      deepHistory: true,
    });

    expect(statsQueries.length).toBeGreaterThan(0);
    expect(orderQueries).toHaveLength(0);
    // REDEEMED — updatedAt → архивный фильтр по дате обновления.
    expect(statsQueries[0].updateFrom).toBe('2026-06-15');
    expect(statsQueries[0].statuses).toEqual(['DELIVERED']);
    expect(result.count).toBe(1);
    // Продажи архивного заказа — платёж покупателя 3000 плюс синтезированные из
    // CASHBACK/MARKETPLACE субсидии 200 + 500: у архива своя форма, но деньги
    // после маппера обязаны считаться той же формулой, что у getOrders.
    expect(result.totals.sales).toBe(3700);
    expect(result.totals.subsidies).toBe(700);
  });

  it('свежий период под флагом остаётся на getOrders', async () => {
    const { reports, statsQueries, orderQueries } = await service({ orders: [] });
    await reports.build(STORE, REPORT.REDEEMED, NOW, { key: PERIOD.TODAY }, { deepHistory: true });

    expect(statsQueries).toHaveLength(0);
    expect(orderQueries.length).toBeGreaterThan(0);
  });

  it('без флага глубокий период отклоняется, как раньше', async () => {
    const { reports } = await service();
    await expect(reports.build(STORE, REPORT.REDEEMED, NOW, DEEP_DAY)).rejects.toThrow(
      /не старше 30 дней/,
    );
  });

  it('«Уехало клиенту»: глубокий ДЕНЬ не имеет архива и под флагом', async () => {
    // У stats/orders нет фильтра по дате отгрузки — честный отказ лучше
    // правдоподобно неверного отчёта по другому фильтру. Архив открыт этому
    // отчёту только на «Всего», где дат в запросе нет вовсе.
    const { reports } = await service();
    await expect(
      reports.build(STORE, REPORT.SHIPPED_TODAY, NOW, DEEP_DAY, { deepHistory: true }),
    ).rejects.toThrow(/не старше 30 дней/);
  });

  it('«Уехало клиенту» на «Всего» + флаг → архив без дат, срезовые статусы', async () => {
    // Снимок «сейчас в пути»: getOrders без дат отдаёт ~30 дней, архив — всё.
    const { reports, statsQueries, orderQueries } = await service({
      stats: [
        { ...STATS_ORDER, status: 'DELIVERY' },
        { ...STATS_ORDER, id: 99, status: 'DELIVERED' },
      ],
    });
    const result = await reports.build(
      STORE,
      REPORT.SHIPPED_TODAY,
      NOW,
      { key: PERIOD.ALL },
      { deepHistory: true },
    );

    expect(orderQueries).toHaveLength(0);
    expect(statsQueries).toHaveLength(1);
    expect(statsQueries[0].statuses).toEqual(['DELIVERY', 'PICKUP']);
    expect(statsQueries[0]).not.toHaveProperty('dateFrom');
    expect(statsQueries[0]).not.toHaveProperty('updateFrom');
    // DELIVERED из архива в снимок не пролезает: эффективный набор один и в
    // запросе, и в отборе ответа.
    expect(result.count).toBe(1);
    expect(result.viaArchive).toBe(true);
  });

  it('«Уехало клиенту» на «Всего» без флага остаётся на getOrders', async () => {
    const { reports, statsQueries, orderQueries } = await service({ orders: [] });
    const result = await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW, { key: PERIOD.ALL });

    expect(statsQueries).toHaveLength(0);
    expect(orderQueries).toHaveLength(1);
    expect(result.viaArchive).toBeFalsy();
  });
});
