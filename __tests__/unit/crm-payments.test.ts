import type { ICrmPaymentsView } from '../../src/modules/crm/payments/crm-payments.domain';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { CrmJobError } from '../../src/modules/crm/jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../../src/modules/crm/jobs/crm-jobs.registry';
import {
  PAYMENTS_JOB_KIND,
  paymentsOptions,
} from '../../src/modules/crm/payments/crm-payments.domain';
import { CrmPaymentsKinds } from '../../src/modules/crm/payments/crm-payments.kinds';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import {
  PAYMENTS_PERIOD_LABELS,
  paymentsFileName,
  paymentsRange,
} from '../../src/modules/yandex/payments/payments.domain';
import { PaymentsReportService } from '../../src/modules/yandex/payments/payments-report.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';

const NOW = new Date('2026-08-03T10:00:00+03:00');
const STORE = { token: 'ACMA:x', campaign_id: '1', business_id: '2' } as never;
const XLSX_BUFFER = Buffer.from('xlsx-from-market');

/** Реальный PaymentsReportService поверх клиента-заглушки. */
async function setup(fileUrl: string | null = 'https://market/file.xlsx') {
  const client = {
    generateUnitedNettingReport: vi.fn(async () => 'report-1'),
    getReportInfo: vi.fn(async () => ({ status: 'DONE', fileUrl })),
    downloadReportFile: vi.fn(async () => XLSX_BUFFER),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      PaymentsReportService,
      CrmJobsRegistry,
      CrmPaymentsKinds,
      { provide: YandexClientFactory, useValue: { forStore: () => client } },
    ],
  }).compile();
  await moduleRef.init();

  return {
    client,
    kinds: moduleRef.get(CrmPaymentsKinds),
    registry: moduleRef.get(CrmJobsRegistry),
  };
}

const context = (params: Record<string, unknown>) => ({
  telegramUserId: '222',
  store: STORE,
  params,
  features: {},
});

describe('«Платежи» в CRM (TASK-084)', () => {
  it('kind зарегистрирован под фичей payments_report', async () => {
    const { registry } = await setup();
    expect(registry.get(PAYMENTS_JOB_KIND)?.features).toEqual([FEATURE.PAYMENTS_REPORT]);
  });

  it('даты считаются в момент выполнения тем же paymentsRange, файл — xlsx Маркета как есть', async () => {
    const { kinds, client } = await setup();

    const output = await kinds.run(context({ period: 'prevmonth' }), NOW);

    const range = paymentsRange('prevmonth', NOW);
    expect(range).toEqual({ dateFrom: '2026-07-01', dateTo: '2026-07-31' });
    expect(client.generateUnitedNettingReport).toHaveBeenCalledWith(range);
    expect(output.file?.buffer).toBe(XLSX_BUFFER);
    expect(output.file?.filename).toBe(paymentsFileName(range, NOW));
    expect(output.data).toEqual<ICrmPaymentsView>({
      period: 'prevmonth',
      ...range,
      empty: false,
      emptyText: null,
      filename: paymentsFileName(range, NOW),
    });
  });

  it('DONE без файла — «данных нет» текстом бота без значка, не ошибка', async () => {
    const { kinds } = await setup(null);

    const output = await kinds.run(context({ period: 'week' }), NOW);
    const view = output.data as ICrmPaymentsView;

    expect(output.file).toBeNull();
    expect(view.empty).toBe(true);
    expect(view.emptyText).toBe('За период 28-07-2026 — 03-08-2026 платежей нет.');
  });

  it.each([undefined, 'year', 42, { key: 'month' }])(
    'мусорный период %j — CrmJobError',
    async (period) => {
      const { kinds, client } = await setup();
      await expect(kinds.run(context({ period }), NOW)).rejects.toBeInstanceOf(CrmJobError);
      expect(client.generateUnitedNettingReport).not.toHaveBeenCalled();
    },
  );

  it('опции формы — из PAYMENTS_PERIOD_LABELS, не копия', () => {
    expect(paymentsOptions().periods).toEqual(
      Object.entries(PAYMENTS_PERIOD_LABELS).map(([key, label]) => ({ key, label })),
    );
  });
});
