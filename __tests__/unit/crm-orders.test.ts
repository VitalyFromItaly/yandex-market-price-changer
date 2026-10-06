import type { ICrmOrdersView } from '../../src/modules/crm/orders/crm-orders.domain';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../../src/modules/crm/jobs/crm-jobs.registry';
import { ordersJobKind, parseOrdersParams } from '../../src/modules/crm/orders/crm-orders.domain';
import { CrmOrdersKinds } from '../../src/modules/crm/orders/crm-orders.kinds';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';

const NOW = new Date('2026-08-03T10:00:00+03:00');
const STORE = { token: 'ACMA:x', campaign_id: '1', business_id: '2' } as never;
const RETURN_DATE = '2026-08-03T09:00:00+03:00';

const ORDERS = [
  {
    id: 11,
    status: 'DELIVERY',
    creationDate: '01-08-2026',
    itemsTotal: 1000,
    deliveryTotal: 150,
    subsidies: [{ type: 'YANDEX_CASHBACK', amount: 120 }],
    items: [{ offerId: 'A-1', offerName: 'Часы <Восток>', count: 2 }],
  },
  {
    id: 12,
    status: 'DELIVERED',
    creationDate: '02-08-2026',
    itemsTotal: 2500.5,
    deliveryTotal: 0,
    items: [{ offerId: 'B-2', offerName: 'Casio', count: 1 }],
  },
  {
    id: 13,
    status: 'DELIVERY',
    substatus: 'FULL_NOT_RANSOM',
    creationDate: '02-08-2026',
    itemsTotal: 700,
    items: [{ offerId: 'C-3', offerName: 'Orient', count: 1 }],
  },
];

const RETURNS = [
  {
    returnId: 1,
    orderId: 555,
    creationDate: RETURN_DATE,
    shipmentStatus: 'IN_TRANSIT',
    amount: { value: 430 },
    items: [{ offerId: 'D-4', count: 3 }],
  },
];

/** Реальный OrderReportsService поверх клиента-заглушки — как в order-reports.test.ts. */
async function setup() {
  const stats = vi.fn(async function* () {
    /* архив пуст — важен сам факт обращения */
  });
  const client = {
    async *iterateOrders() {
      yield ORDERS;
    },
    async *iterateReturns() {
      yield RETURNS;
    },
    iterateOrdersStats: stats,
    listStores: vi.fn(async () => []),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      OrderReportsService,
      CrmJobsRegistry,
      CrmOrdersKinds,
      { provide: YandexClientFactory, useValue: { forStore: () => client } },
    ],
  }).compile();
  await moduleRef.init();

  return {
    reports: moduleRef.get(OrderReportsService),
    kinds: moduleRef.get(CrmOrdersKinds),
    registry: moduleRef.get(CrmJobsRegistry),
    stats,
  };
}

const context = (params: Record<string, unknown> = {}, features: Record<string, boolean> = {}) => ({
  telegramUserId: '222',
  store: STORE,
  params,
  features,
});

function sheetOf(buffer: Buffer): unknown[][] {
  const book = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
}

describe('Отчёты о заказах в CRM (TASK-075)', () => {
  it('регистрирует четыре kind-а, каждый под своей фичей report_*', async () => {
    const { registry } = await setup();
    expect(registry.get(ordersJobKind(REPORT.SHIPPED_TODAY))?.features).toEqual([
      FEATURE.REPORT_SHIPPED_TODAY,
    ]);
    expect(registry.get(ordersJobKind(REPORT.REDEEMED))?.features).toEqual([
      FEATURE.REPORT_REDEEMED,
    ]);
    expect(registry.get(ordersJobKind(REPORT.RETURNING))?.features).toEqual([
      FEATURE.REPORT_RETURNING,
    ]);
    expect(registry.get(ordersJobKind(REPORT.IN_TRANSIT))?.features).toEqual([
      FEATURE.REPORT_IN_TRANSIT,
    ]);
    // Прибыль и калькулятор — свои разделы.
    expect(registry.get(ordersJobKind(REPORT.PROFIT as never))).toBeUndefined();
  });

  it.each([
    ['shipped', REPORT.SHIPPED_TODAY, 'exportShipped'],
    ['in transit', REPORT.IN_TRANSIT, 'exportInTransit'],
    ['returning', REPORT.RETURNING, 'exportReturning'],
  ] as const)('%s: числа = build(), книга = книга бота', async (_, key, method) => {
    const { reports, kinds } = await setup();
    const period = { key: PERIOD.MONTH } as const;

    const crm = await kinds.run(key, context({ period }), NOW);
    const view = crm.data as ICrmOrdersView;
    const built = await reports.build(
      STORE,
      key,
      NOW,
      key === REPORT.IN_TRANSIT ? undefined : period,
    );
    const bot =
      method === 'exportInTransit'
        ? await reports.exportInTransit(STORE, NOW)
        : await reports[method](STORE, period, NOW);

    expect(view.count).toBe(built.count);
    expect(view.totals).toEqual(built.totals);
    expect(bot.empty).toBe(false);
    expect(crm.file?.filename).toBe(bot.filename);
    // Буферы различаются метаданными книги — сравниваем содержимое листа.
    expect(sheetOf(crm.file?.buffer as Buffer)).toEqual(sheetOf(bot.buffer as Buffer));
  });

  it('Σ строк таблицы = итог; в «Едет обратно» — невыкупы и возвраты', async () => {
    const { kinds } = await setup();
    const view = (
      await kinds.run(REPORT.RETURNING, context({ period: { key: PERIOD.MONTH } }), NOW)
    ).data as ICrmOrdersView;

    const sum = (field: 'sales' | 'subsidies' | 'withDelivery') =>
      view.rows.reduce((acc, row) => acc + row[field], 0);
    expect(sum('sales')).toBeCloseTo(view.totals.sales, 6);
    expect(sum('subsidies')).toBeCloseTo(view.totals.subsidies, 6);
    expect(sum('withDelivery')).toBeCloseTo(view.totals.withDelivery, 6);

    expect(view.rows.map((row) => row.type)).toEqual(['nonRedemption', 'return']);
    expect(view.rows[0].status).toBe('FULL_NOT_RANSOM');
    // Строки заказов и возвратов читаются одинаково — артикулом, не названием.
    expect(view.rows[0].items).not.toMatch(/Часы|Casio|Orient/);
    // У возврата нет названий — только артикул.
    expect(view.rows[1]).toMatchObject({ orderId: 555, items: 'D-4 ×3', sales: 430 });
    expect(view.returns).toMatchObject({ count: 1, inFlight: 1, activeOnly: false });
  });

  it('«Выкуплено» тоже отдаёт книгу заказов — vykupleno-…xlsx', async () => {
    const { kinds } = await setup();
    const out = await kinds.run(REPORT.REDEEMED, context({ period: { key: PERIOD.TODAY } }), NOW);
    expect(out.file?.filename).toBe('vykupleno-03-08-2026-1000.xlsx');
    expect((out.data as ICrmOrdersView).rows.map((row) => row.orderId)).toEqual([12]);
  });

  it('«Едет до клиента» — срез: момент съёмки вместо периода, params игнорируются', async () => {
    const { kinds } = await setup();
    const view = (await kinds.run(REPORT.IN_TRANSIT, context({ period: { key: 'мусор' } }), NOW))
      .data as ICrmOrdersView;
    expect(view.takenAt).toBe('03-08-2026 10:00');
    expect(view.periodTitle).toBeNull();
  });

  it('«Всего» печатает ту же оговорку, что бот', async () => {
    const { kinds } = await setup();
    const view = (
      await kinds.run(REPORT.SHIPPED_TODAY, context({ period: { key: PERIOD.ALL } }), NOW)
    ).data as ICrmOrdersView;
    expect(view.notes).toContain('Заказы Яндекс.Маркет отдаёт не старше 30 дней.');
    expect(view.period).toEqual({ key: PERIOD.ALL, day: null });
  });

  it('день глубже 30 дней без deep_history — понятный отказ, с флагом — архив', async () => {
    const { kinds, stats } = await setup();
    const params = { period: { key: PERIOD.DAY, day: '01-06-2026' } };

    const refusal = kinds.run(REPORT.REDEEMED, context(params), NOW);
    await expect(refusal).rejects.toBeInstanceOf(CrmJobError);
    await expect(refusal).rejects.toThrow(/не старше 30 дней/);
    expect(stats).not.toHaveBeenCalled();

    const view = (
      await kinds.run(REPORT.REDEEMED, context(params, { [FEATURE.DEEP_HISTORY]: true }), NOW)
    ).data as ICrmOrdersView;
    expect(stats).toHaveBeenCalled();
    expect(view.period).toEqual({ key: PERIOD.DAY, day: '01-06-2026' });
  });

  it('неверный период — CrmJobError с текстом для продавца', () => {
    expect(() => parseOrdersParams(REPORT.REDEEMED, { period: 'month' })).toThrow(CrmJobError);
    expect(() => parseOrdersParams(REPORT.REDEEMED, { period: { key: 'year' } })).toThrow(
      CrmJobError,
    );
    expect(() =>
      parseOrdersParams(REPORT.REDEEMED, { period: { key: PERIOD.DAY, day: '31-02-2026' } }),
    ).toThrow(/ДД-ММ-ГГГГ/);
    expect(
      parseOrdersParams(REPORT.REDEEMED, { period: { key: PERIOD.DAY, day: '28.07.2026' } }),
    ).toEqual({ key: PERIOD.DAY, day: { year: 2026, month: 7, day: 28 } });
    expect(parseOrdersParams(REPORT.REDEEMED, {})).toEqual({ key: PERIOD.TODAY });
  });
});
