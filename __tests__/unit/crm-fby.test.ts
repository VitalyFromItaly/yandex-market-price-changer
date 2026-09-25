import type { ICrmFbyView } from '../../src/modules/crm/fby/crm-fby.domain';
import type { IFbyStockSummary } from '../../src/modules/yandex/fby/fby-stock-report';
import type { IFbySupplyRequest } from '../../src/modules/yandex/yandex-api.client';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { FBY_JOB_KIND } from '../../src/modules/crm/fby/crm-fby.domain';
import { CrmFbyKinds } from '../../src/modules/crm/fby/crm-fby.kinds';
import { CrmJobsRegistry } from '../../src/modules/crm/jobs/crm-jobs.registry';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { formatFbyOverview } from '../../src/modules/yandex/fby/fby-message';
import { FbyStockService } from '../../src/modules/yandex/fby/fby-stock.service';
import { fbyFileName } from '../../src/modules/yandex/fby/fby-workbook';
import { FbyService } from '../../src/modules/yandex/fby/fby.service';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';

const NOW = new Date('2026-09-24T10:05:00+03:00');
const TAKEN = new Date('2026-09-24T10:04:00+03:00');
const store = {
  token: 'ACMA:x',
  campaign_id: '1',
  business_id: '2',
  telegramUserId: '222',
} as never;

const zero = {
  AVAILABLE: 0,
  FIT: 0,
  FREEZE: 0,
  QUARANTINE: 0,
  DEFECT: 0,
  EXPIRED: 0,
  UTILIZATION: 0,
};

const SUMMARY: IFbyStockSummary = {
  totals: { ...zero, AVAILABLE: 15, DEFECT: 2 },
  problems: [{ sku: 'W-1', name: 'Часы', defect: 2, expired: 0, utilization: 0 }],
  rows: [
    {
      sku: 'W-1',
      name: 'Часы',
      warehouse: 'Софьино',
      totals: { ...zero, AVAILABLE: 10, DEFECT: 2 },
    },
    { sku: 'W-2', name: 'Часы 2', warehouse: 'Новый склад', totals: { ...zero, AVAILABLE: 5 } },
  ],
  byWarehouse: {
    Софьино: { ...zero, AVAILABLE: 10, DEFECT: 2 },
    'Новый склад': { ...zero, AVAILABLE: 5 },
  },
};

const REQUESTS: IFbySupplyRequest[] = [
  { id: '1', type: 'WITHDRAW', status: 'FINISHED', defectCount: 0, planCount: 0, factCount: 0 },
  {
    id: '2',
    type: 'UTILIZATION',
    status: 'READY_FOR_UTILIZATION',
    defectCount: 3,
    planCount: 0,
    factCount: 0,
    targetName: 'Софьино',
  },
  { id: '3', type: 'STRANGE', status: 'NEW_CODE', defectCount: 0, planCount: 0, factCount: 0 },
];

const SUPPLIES: IFbySupplyRequest[] = [
  { id: 's1', type: 'SUPPLY', status: 'CREATED', defectCount: 0, planCount: 5, factCount: 0 },
  {
    id: 's2',
    type: 'SUPPLY',
    status: 'WAREHOUSE_HANDLING',
    defectCount: 0,
    planCount: 10,
    factCount: 4,
    requestedDate: '2026-09-30T00:00:00+03:00',
  },
  { id: 's3', type: 'SUPPLY', status: 'FINISHED', defectCount: 0, planCount: 1, factCount: 1 },
];

interface ISetup {
  stockOk?: boolean;
  suppliesFail?: boolean;
}

async function setup({ stockOk = true, suppliesFail = false }: ISetup = {}) {
  const loadSupplyRequests = vi.fn(async (types: string[]) => {
    if (types.includes('SUPPLY')) {
      if (suppliesFail) throw new Error('boom');
      return SUPPLIES;
    }
    return REQUESTS;
  });
  const stock = {
    safeLoad: vi.fn(async () =>
      stockOk
        ? { snapshot: { summary: SUMMARY, takenAt: TAKEN } }
        : { snapshot: null, error: 'rate_limit' as const },
    ),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      FbyService,
      CrmJobsRegistry,
      CrmFbyKinds,
      { provide: YandexClientFactory, useValue: { forStore: () => ({ loadSupplyRequests }) } },
      { provide: OrderReportsService, useValue: { build: vi.fn(async () => ({ count: 7 })) } },
      { provide: ErrorReporter, useValue: { report: vi.fn(async () => undefined) } },
      { provide: FbyStockService, useValue: stock },
    ],
  }).compile();
  await moduleRef.init();
  return {
    service: moduleRef.get(FbyService),
    kinds: moduleRef.get(CrmFbyKinds),
    registry: moduleRef.get(CrmJobsRegistry),
    loadSupplyRequests,
  };
}

const context = (features: Record<string, boolean> = {}) => ({
  telegramUserId: '222',
  store,
  params: {},
  features,
});

describe('FbyService.buildData — данные под обоими каналами (TASK-086)', () => {
  it('build бота = formatFbyOverview поверх buildData, файл — та же книга', async () => {
    const { service } = await setup();
    const report = await service.buildData(store, NOW, { supply: true });
    const screen = await service.build(store, NOW, { supply: true });

    expect(screen.text).toBe(formatFbyOverview(report.data, NOW));
    expect(report.stockTakenAt).toEqual(TAKEN);
    expect(report.workbook?.filename).toBe(fbyFileName('24-09-2026', '10:05'));
    expect(screen.stockExport?.filename).toBe(report.workbook?.filename);
  });

  it('остатки не добылись — книги нет', async () => {
    const { service } = await setup({ stockOk: false });
    const report = await service.buildData(store, NOW);
    expect(report.workbook).toBeNull();
    expect(report.stockTakenAt).toBeNull();
  });
});

describe('kind «FBY» в CRM', () => {
  it('зарегистрирован под FBY-only фичей fby', async () => {
    const { registry } = await setup();
    expect(registry.get(FBY_JOB_KIND)?.features).toEqual([FEATURE.FBY]);
  });

  it('вид: кластеры, заявки в порядке бота с подписями, поставки без терминальных', async () => {
    const { kinds } = await setup();
    const output = await kinds.run(context({ [FEATURE.FBY_SUPPLY]: true }), NOW);
    const view = output.data as ICrmFbyView;

    expect(view.takenAt).toBe('24-09-2026 10:05');
    expect(view.stockTakenAt).toBe('24-09-2026 10:04');
    expect(view.stockProblem).toBeNull();
    expect(view.stock?.clusters.map((c) => c.title)).toEqual(['Москва', 'Новый склад']);
    expect(view.stock?.clusters[0]?.totals.AVAILABLE).toBe(10);

    expect(view.requests?.map((r) => r.id)).toEqual(['2', '3', '1']);
    expect(view.requests?.[0]).toMatchObject({
      typeLabel: 'утилизация',
      statusLabel: 'готово к утилизации',
      ready: true,
      targetName: 'Софьино',
    });
    // Неизвестный код — как есть, без экранирования (оно дело HTML бота).
    expect(view.requests?.[1]).toMatchObject({ typeLabel: 'strange', statusLabel: 'NEW_CODE' });

    expect(view.supplies).toMatchObject({ state: 'ok', terminal: 1 });
    if (view.supplies.state !== 'ok') throw new Error('supplies');
    expect(view.supplies.rows.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(view.supplies.rows[0]).toMatchObject({
      date: '30-09-2026',
      statusLabel: 'приёмка на складе',
    });

    expect(view.inTransit).toBe(7);
    expect(output.file?.filename).toBe(view.file?.filename);
  });

  it('fby_supply выключен — секции нет и запроса поставок нет', async () => {
    const { kinds, loadSupplyRequests } = await setup();
    const view = (await kinds.run(context(), NOW)).data as ICrmFbyView;

    expect(view.supplies).toEqual({ state: 'off' });
    expect(loadSupplyRequests).not.toHaveBeenCalledWith(['SUPPLY']);
  });

  it('сбой поставок — error с текстом бота без значка', async () => {
    const { kinds } = await setup({ suppliesFail: true });
    const view = (await kinds.run(context({ [FEATURE.FBY_SUPPLY]: true }), NOW))
      .data as ICrmFbyView;
    expect(view.supplies).toEqual({ state: 'error', text: 'Поставки временно недоступны.' });
  });

  it('сбой остатков — stock null, причина без значка, файла нет', async () => {
    const { kinds } = await setup({ stockOk: false });
    const output = await kinds.run(context(), NOW);
    const view = output.data as ICrmFbyView;

    expect(view.stock).toBeNull();
    expect(view.stockProblem).toBe('Остатки обновляются, попробуйте через минуту.');
    expect(output.file).toBeNull();
    expect(view.file).toBeNull();
  });
});
