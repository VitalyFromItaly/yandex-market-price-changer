import type { ICrmCardsView } from '../../src/modules/crm/cards/crm-cards.domain';
import type { IOfferCard } from '../../src/modules/yandex/cards/cards.domain';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { CARDS_JOB_KIND } from '../../src/modules/crm/cards/crm-cards.domain';
import { CrmCardsKinds } from '../../src/modules/crm/cards/crm-cards.kinds';
import { CrmJobsRegistry } from '../../src/modules/crm/jobs/crm-jobs.registry';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { OfferCardsProcessor } from '../../src/modules/telegram/queue/processors/offer-cards.processor';
import { cardsFileName } from '../../src/modules/yandex/cards/cards-message';
import { CardsService } from '../../src/modules/yandex/cards/cards.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';

const NOW = new Date('2026-09-24T10:05:00+03:00');
const store = { token: 'ACMA:x', campaign_id: '1', business_id: '2' } as never;

const CARDS: IOfferCard[] = [
  {
    offerId: 'A',
    cardStatus: 'HAS_CARD_CAN_UPDATE',
    contentRating: 80,
    averageContentRating: 70,
    recommendations: [],
    errorsCount: 0,
    warningsCount: 1,
  },
  {
    offerId: 'B',
    cardStatus: 'NO_CARD_ERRORS',
    contentRating: 20,
    averageContentRating: 70,
    recommendations: [{ type: 'PICTURE_COUNT', percent: 40 }, { type: 'SOMETHING_NEW' }],
    errorsCount: 2,
    warningsCount: 0,
  },
];

async function setup(cards: IOfferCard[] = CARDS) {
  const client = { loadOfferCards: vi.fn(async () => cards) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      CardsService,
      CrmJobsRegistry,
      CrmCardsKinds,
      { provide: YandexClientFactory, useValue: { forStore: () => client } },
    ],
  }).compile();
  await moduleRef.init();
  return {
    service: moduleRef.get(CardsService),
    kinds: moduleRef.get(CrmCardsKinds),
    registry: moduleRef.get(CrmJobsRegistry),
  };
}

const context = { telegramUserId: '222', store, params: {}, features: {} };

describe('«Карточки» — сервис на оба канала (TASK-085)', () => {
  it('сводка из summarizeCards, книга и имя файла — от одного момента', async () => {
    const { service } = await setup();
    const report = await service.build(store, NOW);

    expect(report.summary.totalCards).toBe(2);
    expect(report.summary.byStatus[0].status).toBe('NO_CARD_ERRORS');
    expect(report.workbook?.filename).toBe(cardsFileName(NOW));
  });

  it('карточек нет — книги нет', async () => {
    const { service } = await setup([]);
    expect((await service.build(store, NOW)).workbook).toBeNull();
  });
});

describe('«Карточки» в CRM (TASK-085)', () => {
  it('kind зарегистрирован под своей фичей', async () => {
    const { registry } = await setup();
    expect(registry.get(CARDS_JOB_KIND)?.features).toEqual([FEATURE.OFFER_CARDS]);
  });

  it('подписи статусов и рекомендаций — из домена бота, неизвестный код как есть', async () => {
    const { kinds } = await setup();
    const output = await kinds.run(context, NOW);
    const data = output.data as ICrmCardsView;

    expect(data.takenAt).toBe('24-09-2026 10:05');
    expect(data.summary.byStatus[0]).toMatchObject({
      status: 'NO_CARD_ERRORS',
      actionable: true,
      count: 1,
    });
    expect(data.summary.byStatus[1]).toMatchObject({
      status: 'HAS_CARD_CAN_UPDATE',
      actionable: false,
    });
    const b = data.rows.find((row) => row.offerId === 'B');
    expect(b).toMatchObject({ actionable: true, errorsCount: 2, contentRating: 20 });
    expect(b?.statusLabel).not.toBe('NO_CARD_ERRORS');
    expect(b?.recommendations[0]).toContain('(заполнено 40%)');
    expect(b?.recommendations[1]).toBe('SOMETHING_NEW');
    expect(data.file).toEqual({ filename: cardsFileName(NOW), rows: 2, truncated: 0 });
    expect(output.file?.filename).toBe(cardsFileName(NOW));
  });

  it('карточек нет — data не null, текст бота без значка, файла нет', async () => {
    const { kinds } = await setup([]);
    const output = await kinds.run(context, NOW);
    const data = output.data as ICrmCardsView;

    expect(data.emptyText).toBeTruthy();
    expect(data.emptyText).toMatch(/^[\p{L}\p{N}«"(]/u);
    expect(data.rows).toEqual([]);
    expect(output.file).toBeNull();
  });
});

describe('OfferCardsProcessor на сервисе', () => {
  it('текст сводки и файл — из отчёта сервиса', async () => {
    const { service } = await setup();
    const report = await service.build(store, NOW);
    const sendMessage = vi.fn(async () => undefined);
    const sendDocument = vi.fn(async () => undefined);
    const processor = new OfferCardsProcessor(
      {
        findByTelegramId: () => ({ telegraf: { telegram: { sendMessage, sendDocument } } }),
      } as never,
      { findByTelegramUser: async () => store } as never,
      { build: async () => report } as never,
      { report: vi.fn() } as never,
    );

    await processor.run({ data: { botId: 1, chatId: '9', telegramUserId: '222' } } as never);

    expect(sendMessage.mock.calls[0][1]).toContain('24-09-2026 10:05');
    expect(sendDocument).toHaveBeenCalledWith('9', {
      source: report.workbook?.buffer,
      filename: cardsFileName(NOW),
    });
  });
});
