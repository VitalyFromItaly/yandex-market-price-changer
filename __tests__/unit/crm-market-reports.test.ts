import type { ICrmMarketReportView } from '../../src/modules/crm/market-reports/crm-market-reports.domain';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../../src/modules/crm/jobs/crm-jobs.registry';
import {
  marketReportJobKind,
  marketReportsOptions,
  parseMarketParams,
} from '../../src/modules/crm/market-reports/crm-market-reports.domain';
import { CrmMarketReportsKinds } from '../../src/modules/crm/market-reports/crm-market-reports.kinds';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import {
  KEY_DETALIZATIONS,
  MARKET_REPORT_KEYS,
  MARKET_REPORT_META,
  SHOWS_GROUPINGS,
  mktFileName,
  realizationMonths,
} from '../../src/modules/yandex/market-reports/market-reports.domain';
import { MarketReportsService } from '../../src/modules/yandex/market-reports/market-reports.service';
import { PAYMENTS_PERIOD_LABELS } from '../../src/modules/yandex/payments/payments.domain';
import { StockSyncService } from '../../src/modules/yandex/stocks/stock-sync.service';
import { YandexApiError, YandexRateLimitError } from '../../src/modules/yandex/yandex-api.errors';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';

const NOW = new Date('2026-08-03T10:00:00+03:00');
const XLSX_BUFFER = Buffer.from('xlsx-from-market');

const store = (placementType?: string) =>
  ({
    token: 'ACMA:x',
    campaign_id: '1',
    business_id: '2',
    stores: placementType ? [{ campaignId: '1', placementType }] : [],
  }) as never;

interface ISetup {
  fileUrl?: string | null;
  generate?: () => Promise<string>;
  livePlacement?: string;
}

/** Реальный MarketReportsService поверх клиента-заглушки. */
async function setup({
  fileUrl = 'https://market/file.xlsx',
  generate,
  livePlacement,
}: ISetup = {}) {
  const client = {
    generateReport: vi.fn(generate ?? (async () => 'report-1')),
    getReportInfo: vi.fn(async () => ({ status: 'DONE', fileUrl })),
    downloadReportFile: vi.fn(async () => XLSX_BUFFER),
  };
  const placementFor = vi.fn(async () => livePlacement);
  const moduleRef = await Test.createTestingModule({
    providers: [
      MarketReportsService,
      CrmJobsRegistry,
      CrmMarketReportsKinds,
      { provide: YandexClientFactory, useValue: { forStore: () => client } },
      { provide: StockSyncService, useValue: { placementFor } },
    ],
  }).compile();
  await moduleRef.init();

  return {
    client,
    placementFor,
    kinds: moduleRef.get(CrmMarketReportsKinds),
    registry: moduleRef.get(CrmJobsRegistry),
  };
}

const context = (params: Record<string, unknown>, placementType = 'FBS') => ({
  telegramUserId: '222',
  store: store(placementType),
  params,
  features: {},
});

describe('«Отчёты Маркета» в CRM (TASK-084)', () => {
  it('шесть kind-ов, все под одной фичей market_reports', async () => {
    const { registry } = await setup();
    for (const key of MARKET_REPORT_KEYS) {
      expect(registry.get(marketReportJobKind(key))?.features).toEqual([FEATURE.MARKET_REPORTS]);
    }
  });

  it('kind зовёт тот же сервис: тело generate строит MarketReportsService, даты — в момент выполнения', async () => {
    const { kinds, client } = await setup();

    const output = await kinds.run(
      'shows',
      context({ periodKey: 'prevmonth', grouping: 'OFFERS' }),
      NOW,
    );

    expect(client.generateReport).toHaveBeenCalledWith(expect.any(String), {
      businessId: 2,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      grouping: 'OFFERS',
    });
    expect(output.file?.buffer).toBe(XLSX_BUFFER);
    expect(output.data).toEqual<ICrmMarketReportView>({
      key: 'shows',
      params: { periodKey: 'prevmonth', grouping: 'OFFERS' },
      empty: false,
      emptyText: null,
      filename: mktFileName('shows', NOW),
    });
  });

  it('DONE без файла — «данных нет» текстом бота без значка', async () => {
    const { kinds } = await setup({ fileUrl: null });

    const output = await kinds.run('key', context({ detalizationLevel: 'MONTH' }), NOW);
    const view = output.data as ICrmMarketReportView;

    expect(output.file).toBeNull();
    expect(view.empty).toBe(true);
    expect(view.emptyText).toBe('«Ключевые показатели»: данных за выбранный период нет.');
  });

  it('420 у отчёта с квотой в час — mktRateLimitText, не общий «будет позже»', async () => {
    const { kinds } = await setup({
      generate: async () => {
        throw new YandexRateLimitError('limit', 420);
      },
    });

    const run = kinds.run('comp', context({ categoryId: 91491, periodKey: 'month' }), NOW);
    await expect(run).rejects.toBeInstanceOf(CrmJobError);
    await expect(run).rejects.toThrow(
      'Маркет ограничивает «Конкурентная позиция» 10 запросами в час. Попробуйте позже.',
    );
  });

  it('420 у отчёта без квоты в час — наверх, в общий reportErrorMessage', async () => {
    const error = new YandexRateLimitError('limit', 420);
    const { kinds } = await setup({
      generate: async () => {
        throw error;
      },
    });

    await expect(kinds.run('geo', context({ periodKey: 'week' }), NOW)).rejects.toBe(error);
    expect(error).toBeInstanceOf(YandexApiError);
  });

  it('оборачиваемость на FBS — отказ без запроса отчёта', async () => {
    const { kinds, client } = await setup();

    await expect(kinds.run('turn', context({}, 'FBS'), NOW)).rejects.toThrow(
      'Оборачиваемость Маркет считает только для FBY-магазина.',
    );
    expect(client.generateReport).not.toHaveBeenCalled();
  });

  it('оборачиваемость: кэш молчит — модель берётся живым запросом, как в боте', async () => {
    const { kinds, placementFor } = await setup({ livePlacement: 'FBY' });

    const output = await kinds.run(
      'turn',
      { telegramUserId: '222', store: store(), params: {}, features: {} },
      NOW,
    );

    expect(placementFor).toHaveBeenCalledOnce();
    expect(output.file?.buffer).toBe(XLSX_BUFFER);
  });

  describe('params проверяются строго — сервис молча подставил бы умолчания', () => {
    it.each([
      ['real', {}],
      ['real', { year: 2026, month: 13 }],
      ['real', { year: 2026, month: 8 }], // текущий месяц не завершён
      ['real', { year: 2026, month: 9 }],
      ['comp', { periodKey: 'month' }],
      ['comp', { categoryId: '91491', periodKey: 'month' }],
      ['comp', { categoryId: 91491, periodKey: 'year' }],
      ['shows', { periodKey: 'month', grouping: 'BRANDS' }],
      ['key', { detalizationLevel: 'DAY' }],
      ['geo', {}],
    ] as const)('%s %j — CrmJobError', (key, params) => {
      expect(() => parseMarketParams(key, params, NOW)).toThrow(CrmJobError);
    });

    it('реализация — любой завершённый месяц, не только из списка формы', () => {
      // Форма, открытая 31-го и отправленная 1-го, не получает отказ.
      expect(parseMarketParams('real', { year: 2026, month: 7 }, NOW)).toEqual({
        year: 2026,
        month: 7,
      });
      expect(parseMarketParams('real', { year: 2025, month: 12 }, NOW)).toEqual({
        year: 2025,
        month: 12,
      });
    });

    it('оборачиваемость параметров не берёт', () => {
      expect(parseMarketParams('turn', { anything: 1 }, NOW)).toEqual({});
    });
  });

  describe('опции форм — из констант домена бота, не копии', () => {
    it('периоды, месяцы, группировки, детализации', () => {
      const options = marketReportsOptions('FBY', NOW);

      expect(options.periods.map((p) => p.key)).toEqual(Object.keys(PAYMENTS_PERIOD_LABELS));
      expect(options.months).toEqual(realizationMonths(NOW));
      expect(options.groupings).toEqual(
        SHOWS_GROUPINGS.map((g) => ({ key: g.code, label: g.label })),
      );
      expect(options.detalizations).toEqual(
        KEY_DETALIZATIONS.map((d) => ({ key: d.code, label: d.label })),
      );
      expect(options.reports).toEqual(
        MARKET_REPORT_KEYS.map((key) => ({
          key,
          title: MARKET_REPORT_META[key].title,
          hourlyLimit: MARKET_REPORT_META[key].hourlyLimit ?? null,
        })),
      );
    });

    it.each(['FBS', 'DBS', null])('оборачиваемость скрыта у модели %s', (placement) => {
      const keys = marketReportsOptions(placement, NOW).reports.map((r) => r.key);
      expect(keys).not.toContain('turn');
      expect(keys).toHaveLength(MARKET_REPORT_KEYS.length - 1);
    });
  });
});
