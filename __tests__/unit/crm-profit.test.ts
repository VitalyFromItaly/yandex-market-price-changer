import type {
  ICrmProfitView,
  ICrmTariffView,
} from '../../src/modules/crm/profit/crm-profit.domain';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { CostHistoryService } from '../../src/database/services/cost-history.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { unconfirmedOf } from '../../src/shared/profit-confirmation';
import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../../src/modules/crm/jobs/crm-jobs.registry';
import { profitJobKind } from '../../src/modules/crm/profit/crm-profit.domain';
import { CrmProfitKinds } from '../../src/modules/crm/profit/crm-profit.kinds';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { formatRubles } from '../../src/modules/yandex/reports/money';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import {
  formatProfitReport,
  profitExcluded,
} from '../../src/modules/yandex/reports/profit-message';
import { ProfitService } from '../../src/modules/yandex/reports/profit.service';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import { formatTariffCalcReport } from '../../src/modules/yandex/reports/tariff-calc-message';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';

const NOW = new Date('2026-08-03T10:00:00+03:00');
const STORE = {
  telegramUserId: '222',
  token: 'ACMA:x',
  campaign_id: '1',
  business_id: '2',
  commissionPercent: 20,
} as never;

/** Два выкупленных и один едущий: закуп известен у A-1 и C-3, у B-2 — нет. */
const ORDERS = [
  {
    id: 11,
    status: 'DELIVERED',
    creationDate: '01-08-2026',
    itemsTotal: 3000,
    deliveryTotal: 150,
    subsidies: [{ type: 'YANDEX_CASHBACK', amount: 200 }],
    items: [{ offerId: 'A-1', offerName: 'Восток', count: 1, price: 3000 }],
  },
  {
    id: 12,
    status: 'DELIVERED',
    creationDate: '02-08-2026',
    itemsTotal: 2500,
    items: [{ offerId: 'B-2', offerName: 'Casio', count: 1, price: 2500 }],
  },
  {
    id: 13,
    status: 'DELIVERY',
    creationDate: '03-08-2026',
    itemsTotal: 4000,
    items: [{ offerId: 'C-3', offerName: 'Orient', count: 2, price: 2000 }],
  },
];

const PRICES = new Map([
  ['A-1', { price: 1500, name: 'Восток Амфибия', category: 'Часы' }],
  ['C-3', { price: 1000, name: 'Orient', category: 'Часы' }],
]);

async function setup() {
  const calculateTariffs = vi.fn(async (offers: { price: number }[]) =>
    offers.map((offer) => ({
      offer,
      tariffs: [
        { type: 'FEE', amount: offer.price * 0.15 },
        { type: 'DELIVERY_TO_CUSTOMER', amount: 100 },
      ],
    })),
  );
  const client = {
    async *iterateOrders() {
      yield ORDERS;
    },
    async *iterateReturns() {
      yield [];
    },
    async *iterateOrdersStats() {
      /* архив пуст */
    },
    listStores: vi.fn(async () => []),
    getOfferMappings: vi.fn(
      async (skus: string[]) =>
        new Map(skus.map((sku) => [sku, { marketCategoryId: 91491 }] as const)),
    ),
    calculateTariffs,
  };
  const purchasePrices = {
    findBySkus: vi.fn(async (_: string, skus: readonly string[]) => {
      const rows = new Map();
      for (const sku of skus) if (PRICES.has(sku)) rows.set(sku, PRICES.get(sku));
      return rows;
    }),
    lastUpdatedAt: vi.fn(async () => new Date('2026-08-01T09:00:00Z')),
  };

  // Журнал проверен: фактическая чистая 1 234,56 ₽ (TASK-126).
  const finance = {
    actualNet: vi.fn(async () => ({
      state: 'verified' as const,
      netKopecks: 123_456,
      unconfirmed: unconfirmedOf(0, 0, []),
      from: '2026-08-01',
      to: '2026-08-31',
    })),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      OrderReportsService,
      ProfitService,
      CrmJobsRegistry,
      CrmProfitKinds,
      { provide: YandexClientFactory, useValue: { forStore: () => client } },
      { provide: PurchasePriceService, useValue: purchasePrices },
      { provide: CostHistoryService, useValue: { findForSkus: async () => new Map() } },
      { provide: ErrorReporter, useValue: { report: vi.fn() } },
      { provide: FinanceService, useValue: finance },
    ],
  }).compile();
  await moduleRef.init();

  return {
    profit: moduleRef.get(ProfitService),
    kinds: moduleRef.get(CrmProfitKinds),
    registry: moduleRef.get(CrmJobsRegistry),
    calculateTariffs,
    finance,
  };
}

const context = (params: Record<string, unknown> = {}, features: Record<string, boolean> = {}) => ({
  telegramUserId: '222',
  store: STORE,
  params,
  features,
});

const MONTH = { period: { key: PERIOD.MONTH } };

describe('«Прибыль» и «Калькулятор» в CRM (TASK-076)', () => {
  it('регистрирует два kind-а, каждый под своей фичей', async () => {
    const { registry } = await setup();
    expect(registry.get(profitJobKind(REPORT.PROFIT))?.features).toEqual([FEATURE.REPORT_PROFIT]);
    expect(registry.get(profitJobKind(REPORT.TARIFF_CALC))?.features).toEqual([
      FEATURE.TARIFF_CALC,
    ]);
  });

  it('прибыль: числа = ProfitService.build бота, sku без закупа — все', async () => {
    const { profit, kinds } = await setup();
    const view = (await kinds.run(REPORT.PROFIT, context(MONTH), NOW)).data as ICrmProfitView;
    const bot = await profit.build(STORE, { key: PERIOD.MONTH }, NOW, {});

    expect(view.redeemed).toMatchObject({
      orders: bot.totals.orders,
      revenue: bot.totals.revenue,
      commission: bot.totals.commission,
      tax: bot.totals.tax,
      purchase: bot.totals.purchase,
      net: bot.totals.net,
    });
    expect(view.placed.net).toBe(bot.placed.net);
    expect(view.excluded).toMatchObject(profitExcluded(bot));
    expect(view.excluded.skus).toEqual(['B-2']);
    expect(view.period).toEqual({ key: PERIOD.MONTH, day: null });
    expect(view.prices.updatedAt).toBe('01-08-2026');

    // Те же чистые, что в сообщении бота.
    expect(view.main).toBe('placed');
    expect(view.redeemed.orders).toBeGreaterThan(0);
    const text = formatProfitReport(bot, NOW);
    expect(text).toContain(formatRubles(view.placed.net));
    expect(text).toContain(formatRubles(view.redeemed.net));
    expect(view.estimate).toBeNull();
  });

  it('прибыль: ряд по дням у каждого блока и границы периода (TASK-094)', async () => {
    const { profit, kinds } = await setup();
    const view = (await kinds.run(REPORT.PROFIT, context(MONTH), NOW)).data as ICrmProfitView;
    const bot = await profit.build(STORE, { key: PERIOD.MONTH }, NOW, {});

    expect(view.days).toEqual({ from: '2026-08-01', to: '2026-08-03' });
    expect(view.placed.byDay).toEqual(bot.placed.byDay);
    const revenue = view.placed.byDay.reduce((acc, day) => acc + day.revenue, 0);
    expect(revenue).toBe(view.placed.revenue);
    expect(view.placed.byDay.map((day) => day.date)).toEqual(['2026-08-01', '2026-08-03']);

    // Топ товаров главной (TASK-095): тот же разрез, что у бота, Σ = блоку.
    expect(view.placed.bySku).toEqual(bot.placed.bySku);
    expect(view.placed.bySku.map((row) => row.sku)).toEqual(['C-3', 'A-1']);
    const skuRevenue = view.placed.bySku.reduce((acc, row) => acc + row.revenue, 0);
    expect(skuRevenue).toBeCloseTo(view.placed.revenue, 6);

    const all = (await kinds.run(REPORT.PROFIT, context({ period: { key: PERIOD.ALL } }), NOW))
      .data as ICrmProfitView;
    expect(all.days).toBeNull();
  });

  it('tariff_calc из снимка → строка калькулятора; без флага — ни запроса, ни строки', async () => {
    const off = await setup();
    await off.kinds.run(REPORT.PROFIT, context(MONTH), NOW);
    expect(off.calculateTariffs).not.toHaveBeenCalled();

    const on = await setup();
    const view = (
      await on.kinds.run(REPORT.PROFIT, context(MONTH, { [FEATURE.TARIFF_CALC]: true }), NOW)
    ).data as ICrmProfitView;
    expect(on.calculateTariffs).toHaveBeenCalled();
    expect(view.estimate?.servicesTotal).toBeGreaterThan(0);
  });

  it('калькулятор: числа = buildTariffReport, разбивка сходится с «Услугами Маркета»', async () => {
    const { profit, kinds } = await setup();
    const view = (await kinds.run(REPORT.TARIFF_CALC, context(MONTH), NOW)).data as ICrmTariffView;
    const bot = await profit.buildTariffReport(STORE, { key: PERIOD.MONTH }, NOW, {});

    expect(view.block.commission).toBe(bot.totals.commission);
    expect(view.block.net).toBe(bot.totals.net);
    const sum = view.services.reduce((acc, service) => acc + service.sum, 0);
    expect(sum).toBeCloseTo(view.block.commission, 6);
    expect(view.services[0].label).not.toBe(view.services[0].type);
    expect(view.comparison.commissionPercent).toBe(20);
    expect(formatTariffCalcReport(bot, NOW)).toContain('По вашей ставке 20%');
  });

  it('deep_history из снимка доходит до сервиса', async () => {
    const { profit, kinds } = await setup();
    const build = vi.spyOn(profit, 'build');
    const tariff = vi.spyOn(profit, 'buildTariffReport');
    const features = { [FEATURE.DEEP_HISTORY]: true };

    await kinds.run(REPORT.PROFIT, context(MONTH, features), NOW);
    await kinds.run(REPORT.TARIFF_CALC, context(MONTH, features), NOW);
    expect(build.mock.calls[0][3]).toEqual({ tariffEstimate: false, deepHistory: true });
    expect(tariff.mock.calls[0][3]).toEqual({ deepHistory: true });
  });

  it('profit_actual: фактическая чистая — тот же actualNet и то же число, что в тексте бота', async () => {
    const { profit, kinds, finance } = await setup();
    const features = { [FEATURE.FINANCE]: true, [FEATURE.PROFIT_ACTUAL]: true };
    const view = (await kinds.run(REPORT.PROFIT, context(MONTH, features), NOW))
      .data as ICrmProfitView;

    expect(finance.actualNet).toHaveBeenCalledWith('222', { key: PERIOD.MONTH }, NOW);
    expect(view.actual).toMatchObject({ state: 'verified', net: 1234.56, unconfirmed: null });

    const actual = await finance.actualNet.mock.results[0].value;
    const bot = await profit.build(STORE, { key: PERIOD.MONTH }, NOW, {});
    expect(formatProfitReport(bot, NOW, actual)).toContain(formatRubles(1234.56));
  });

  it('без profit_actual журнал не читается и строки нет', async () => {
    const { kinds, finance } = await setup();
    const view = (await kinds.run(REPORT.PROFIT, context(MONTH), NOW)).data as ICrmProfitView;
    expect(finance.actualNet).not.toHaveBeenCalled();
    expect(view.actual).toBeNull();
  });

  it('«Прошлый месяц» — только «Прибыли» и только при profit_actual + deep_history', async () => {
    const { profit, kinds } = await setup();
    const build = vi.spyOn(profit, 'build');
    const prev = { period: { key: PERIOD.PREV_MONTH } };
    const open = {
      [FEATURE.FINANCE]: true,
      [FEATURE.PROFIT_ACTUAL]: true,
      [FEATURE.DEEP_HISTORY]: true,
    };

    await kinds.run(REPORT.PROFIT, context(prev, open), NOW);
    expect(build.mock.calls[0][1]).toEqual({ key: PERIOD.PREV_MONTH });

    await expect(
      kinds.run(REPORT.PROFIT, context(prev, { [FEATURE.DEEP_HISTORY]: true }), NOW),
    ).rejects.toBeInstanceOf(CrmJobError);
    await expect(kinds.run(REPORT.TARIFF_CALC, context(prev, open), NOW)).rejects.toBeInstanceOf(
      CrmJobError,
    );
  });

  it('день глубже 30 дней без deep_history — понятный отказ; мусорный период — тоже', async () => {
    const { kinds } = await setup();
    const deep = kinds.run(
      REPORT.PROFIT,
      context({ period: { key: PERIOD.DAY, day: '01-06-2026' } }),
      NOW,
    );
    await expect(deep).rejects.toBeInstanceOf(CrmJobError);

    const junk = kinds.run(REPORT.TARIFF_CALC, context({ period: { key: 'мусор' } }), NOW);
    await expect(junk).rejects.toBeInstanceOf(CrmJobError);
  });
});
