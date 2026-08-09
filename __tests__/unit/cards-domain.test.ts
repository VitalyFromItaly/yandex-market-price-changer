import { describe, it, expect } from 'vitest';

import {
  cardStatusLabel,
  parseOfferCard,
  recommendationLabel,
  summarizeCards,
  type IOfferCard,
} from '../../src/modules/yandex/cards/cards.domain';
import { cardsText } from '../../src/modules/yandex/cards/cards-message';
import { buildCardsWorkbook } from '../../src/modules/yandex/cards/cards-workbook';

const card = (overrides: Partial<IOfferCard> = {}): IOfferCard => ({
  offerId: 'SKU-1',
  cardStatus: 'HAS_CARD_CAN_UPDATE',
  contentRating: 70,
  averageContentRating: 85,
  recommendations: [],
  errorsCount: 0,
  warningsCount: 0,
  ...overrides,
});

describe('Карточки: разбор ответа', () => {
  it('собирает статус, рейтинги и рекомендации', () => {
    const parsed = parseOfferCard({
      offerId: 'SKU-1',
      cardStatus: 'NO_CARD_NEED_CONTENT',
      contentRating: 40,
      averageContentRating: 90,
      recommendations: [{ type: 'PICTURE_COUNT', percent: 50 }],
      errors: [{}],
      warnings: [{}, {}],
    });

    expect(parsed).toMatchObject({
      offerId: 'SKU-1',
      cardStatus: 'NO_CARD_NEED_CONTENT',
      contentRating: 40,
      errorsCount: 1,
      warningsCount: 2,
    });
    expect(parsed.recommendations[0]).toEqual({
      type: 'PICTURE_COUNT',
      percent: 50,
      remainingRatingPoints: undefined,
    });
  });

  it('без артикула карточка отбрасывается', () => {
    expect(parseOfferCard({})).toBeNull();
  });

  it('подписи: известный код по-русски, неизвестный — как есть', () => {
    expect(cardStatusLabel('NO_CARD_NEED_CONTENT')).toBe('нет карточки — нужен контент');
    expect(cardStatusLabel('BRAND_NEW_STATUS')).toBe('BRAND_NEW_STATUS');
    expect(recommendationLabel({ type: 'PICTURE_COUNT', percent: 50 })).toBe(
      'добавьте изображения (заполнено 50%)',
    );
    expect(recommendationLabel({ type: 'NEW_REC' })).toBe('NEW_REC');
  });
});

describe('Карточки: сводка', () => {
  it('статусы с действием — первыми, худшие по возрастанию рейтинга', () => {
    const summary = summarizeCards([
      card({ offerId: 'ok', cardStatus: 'HAS_CARD_CAN_NOT_UPDATE', contentRating: 95 }),
      card({ offerId: 'bad', cardStatus: 'NO_CARD_NEED_CONTENT', contentRating: 10 }),
      card({ offerId: 'mid', cardStatus: 'HAS_CARD_CAN_UPDATE', contentRating: 60 }),
    ]);

    expect(summary.totalCards).toBe(3);
    expect(summary.byStatus[0].status).toBe('NO_CARD_NEED_CONTENT');
    expect(summary.worst.map((c) => c.offerId)).toEqual(['bad', 'mid', 'ok']);
    expect(summary.averageRating).toBe(55);
  });

  it('карточки без рейтинга не ломают среднее', () => {
    const summary = summarizeCards([card({ contentRating: undefined })]);
    expect(summary.averageRating).toBeNull();
  });
});

describe('Карточки: экран и файл', () => {
  const cards = [
    card({ offerId: 'bad', cardStatus: 'NO_CARD_NEED_CONTENT', contentRating: 10 }),
    card({ offerId: 'ok', contentRating: 90 }),
  ];

  it('текст несёт момент среза, счётчики и слабые карточки', () => {
    const text = cardsText(summarizeCards(cards), new Date('2026-08-15T09:12:00Z'));
    expect(text).toContain('15-08-2026 12:12');
    expect(text).toContain('нет карточки — нужен контент: 1');
    expect(text).toContain('bad');
    expect(text).toContain('приложенном файле');
  });

  it('в файл попадают все карточки, худшие сверху', () => {
    const workbook = buildCardsWorkbook(cards);
    expect(workbook.rows).toBe(2);
    expect(workbook.truncated).toBe(0);
    expect(workbook.buffer.length).toBeGreaterThan(0);
  });
});
