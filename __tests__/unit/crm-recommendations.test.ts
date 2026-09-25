import type { ICrmRecommendationsView } from '../../src/modules/crm/recommendations/crm-recommendations.domain';
import type { IPriceRecommendation } from '../../src/modules/yandex/recommendations/recommendations.domain';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { CrmJobsRegistry } from '../../src/modules/crm/jobs/crm-jobs.registry';
import { RECOMMENDATIONS_JOB_KIND } from '../../src/modules/crm/recommendations/crm-recommendations.domain';
import { CrmRecommendationsKinds } from '../../src/modules/crm/recommendations/crm-recommendations.kinds';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { PriceRecommendationsProcessor } from '../../src/modules/telegram/queue/processors/price-recommendations.processor';
import { recommendationsFileName } from '../../src/modules/yandex/recommendations/recommendations-message';
import { RecommendationsService } from '../../src/modules/yandex/recommendations/recommendations.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';

const NOW = new Date('2026-09-24T10:05:00+03:00');
const store = { token: 'ACMA:x', campaign_id: '1', business_id: '2' } as never;

const ROWS: IPriceRecommendation[] = [
  { offerId: 'A', price: 1100, optimalPrice: 1000, competitiveness: 'AVERAGE', shows: 5 },
  { offerId: 'B', competitiveness: 'LOW' },
  { offerId: 'C', price: 3000, optimalPrice: 2000, averagePrice: 2500, competitiveness: 'LOW' },
];

async function setup(rows: IPriceRecommendation[] = ROWS) {
  const client = { loadPriceRecommendations: vi.fn(async () => rows) };
  const forStore = vi.fn(() => client);
  const moduleRef = await Test.createTestingModule({
    providers: [
      RecommendationsService,
      CrmJobsRegistry,
      CrmRecommendationsKinds,
      { provide: YandexClientFactory, useValue: { forStore } },
    ],
  }).compile();
  await moduleRef.init();
  return {
    client,
    forStore,
    service: moduleRef.get(RecommendationsService),
    kinds: moduleRef.get(CrmRecommendationsKinds),
    registry: moduleRef.get(CrmJobsRegistry),
  };
}

const context = { telegramUserId: '222', store, params: {}, features: {} };

describe('«Рекомендации цен» — сервис на оба канала (TASK-085)', () => {
  it('строки худшими сверху, книга и имя файла — от одного момента среза', async () => {
    const { service, forStore } = await setup();
    const report = await service.build(store, NOW);

    expect(forStore).toHaveBeenCalledWith(store);
    expect(report.rows.map((row) => row.offerId)).toEqual(['C', 'A', 'B']);
    expect(report.takenAt).toBe(NOW);
    expect(report.workbook?.filename).toBe(recommendationsFileName(NOW));
    expect(report.workbook?.rows).toBe(3);
  });

  it('пустой срез — книги нет', async () => {
    const { service } = await setup([]);
    expect((await service.build(store, NOW)).workbook).toBeNull();
  });
});

describe('«Рекомендации цен» в CRM (TASK-085)', () => {
  it('kind зарегистрирован под своей фичей', async () => {
    const { registry } = await setup();
    expect(registry.get(RECOMMENDATIONS_JOB_KIND)?.features).toEqual([
      FEATURE.PRICE_RECOMMENDATIONS,
    ]);
  });

  it('строки таблицы — из домена бота, без порога дельта null, а не 0', async () => {
    const { kinds } = await setup();
    const output = await kinds.run(context, NOW);
    const data = output.data as ICrmRecommendationsView;

    expect(data.takenAt).toBe('24-09-2026 10:05');
    expect(data).toMatchObject({ count: 3, average: 1, low: 2, other: 0, emptyText: null });
    expect(data.rows[0]).toEqual({
      offerId: 'C',
      price: 3000,
      optimalPrice: 2000,
      averagePrice: 2500,
      competitiveness: 'LOW',
      competitivenessLabel: 'непривлекательная',
      shows: null,
      deltaAbs: 1000,
      deltaPercent: 50,
    });
    expect(data.rows[2]).toMatchObject({ offerId: 'B', deltaAbs: null, deltaPercent: null });
    expect(output.file?.filename).toBe(recommendationsFileName(NOW));
    expect(data.file).toEqual({ filename: recommendationsFileName(NOW), rows: 3, truncated: 0 });
  });

  it('пустой срез — data не null, текст бота без значка, файла нет', async () => {
    const { kinds } = await setup([]);
    const output = await kinds.run(context, NOW);
    const data = output.data as ICrmRecommendationsView;

    expect(data).not.toBeNull();
    expect(data.emptyText).toBe('Все цены привлекательные — Маркету предложить нечего.');
    expect(data.rows).toEqual([]);
    expect(output.file).toBeNull();
  });
});

describe('PriceRecommendationsProcessor на сервисе', () => {
  function processorWith(build: ReturnType<typeof vi.fn>) {
    const sendMessage = vi.fn(async () => undefined);
    const sendDocument = vi.fn(async () => undefined);
    const processor = new PriceRecommendationsProcessor(
      {
        findByTelegramId: () => ({ telegraf: { telegram: { sendMessage, sendDocument } } }),
      } as never,
      { findByTelegramUser: async () => store } as never,
      { build } as never,
      { report: vi.fn() } as never,
    );
    return { processor, sendMessage, sendDocument };
  }
  const job = { data: { botId: 1, chatId: '9', telegramUserId: '222' } } as never;

  it('текст и файл — из отчёта сервиса', async () => {
    const { service } = await setup();
    const report = await service.build(store, NOW);
    const { processor, sendMessage, sendDocument } = processorWith(vi.fn(async () => report));

    await processor.run(job);

    expect(sendMessage.mock.calls[0][1]).toContain('на 24-09-2026 10:05 МСК');
    expect(sendDocument).toHaveBeenCalledWith('9', {
      source: report.workbook?.buffer,
      filename: recommendationsFileName(NOW),
    });
  });

  it('пустой срез — только текст «все цены привлекательные»', async () => {
    const { processor, sendMessage, sendDocument } = processorWith(
      vi.fn(async () => ({ rows: [], takenAt: NOW, workbook: null })),
    );
    await processor.run(job);

    expect(sendDocument).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1]).toContain('Все цены привлекательные');
  });
});
