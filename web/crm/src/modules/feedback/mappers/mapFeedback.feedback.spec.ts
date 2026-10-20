import type { FeedbackResponse } from '../feedback.domain';

import { describe, expect, it } from 'vitest';

import { feedbackQuote, mapFeedbackRow, mapFeedbackView, starsOf } from './mapFeedback.feedback';

const empty: FeedbackResponse = {
  feedbackId: 1,
  createdAt: null,
  author: null,
  rating: null,
  orderId: null,
  advantages: null,
  disadvantages: null,
  comment: null,
};

describe('mapFeedback', () => {
  it('звёзды — только при оценке 1..5', () => {
    expect(starsOf(2)).toBe('★★☆☆☆');
    expect(starsOf(null)).toBeNull();
    expect(starsOf(0)).toBeNull();
    expect(starsOf(6)).toBeNull();
  });

  it('пустой отзыв: всё null, частей нет', () => {
    expect(mapFeedbackRow(empty)).toEqual({
      feedbackId: 1,
      rating: null,
      stars: null,
      author: null,
      date: null,
      orderId: null,
      parts: [],
    });
  });

  it('части по порядку, дата по Москве, битая оценка не показывается', () => {
    const row = mapFeedbackRow({
      ...empty,
      createdAt: '2026-09-20T22:30:00Z',
      rating: 9,
      advantages: 'Красивые',
      comment: 'Отстают',
    });
    expect(row.date).toBe('21-09-2026');
    expect(row.rating).toBeNull();
    expect(row.parts).toEqual([
      { label: 'Достоинства', text: 'Красивые' },
      { label: 'Комментарий', text: 'Отстают' },
    ]);
  });

  it('цитата: подписанные части построчно', () => {
    const row = mapFeedbackRow({ ...empty, advantages: 'Да', disadvantages: 'Нет' });
    expect(feedbackQuote(row)).toBe('Достоинства: Да\nНедостатки: Нет');
  });

  it('вид: лимит и подписи — от сервера', () => {
    const view = mapFeedbackView({
      businessName: 'B',
      note: 'n',
      publicNote: 'p',
      productNote: 'pr',
      more: null,
      replyMaxLength: 4096,
      feedbacks: [empty],
    });
    expect(view).toMatchObject({ note: 'n', replyMaxLength: 4096, more: null });
    expect(view.rows).toHaveLength(1);
  });
});
