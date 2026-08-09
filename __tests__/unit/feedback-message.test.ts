import { describe, it, expect } from 'vitest';

import {
  feedbackCardButtons,
  feedbackCardText,
  feedbackHeaderText,
  feedbackPreviewButtons,
  feedbackPreviewText,
} from '../../src/modules/yandex/feedback/feedback-message';

describe('Экран отзывов', () => {
  it('шапка честна про страницу: «50+» при следующей странице', () => {
    expect(feedbackHeaderText(50, true, 5)).toContain('50+');
    expect(feedbackHeaderText(3, false, 3)).toContain(': 3');
    expect(feedbackHeaderText(3, false, 3)).not.toContain('3+');
  });

  it('шапка говорит, сколько карточек показано, когда есть ещё', () => {
    expect(feedbackHeaderText(20, false, 5)).toContain('первые 5');
    expect(feedbackHeaderText(3, false, 3)).not.toContain('первые');
  });

  it('карточка: звёзды, автор и экранированный текст', () => {
    const text = feedbackCardText(
      {
        feedbackId: 1,
        rating: 2,
        author: 'Иван',
        comment: 'Плохие <стрелки>',
      },
      1,
    );
    expect(text).toContain('★★☆☆☆');
    expect(text).toContain('Иван');
    expect(text).toContain('&lt;стрелки&gt;');
  });

  it('отзыв без текста подписан явно', () => {
    expect(feedbackCardText({ feedbackId: 1, rating: 5 }, 1)).toContain('Без текста');
  });

  it('кнопки карточки ведут на свой feedbackId', () => {
    const buttons = feedbackCardButtons({ feedbackId: 42 });
    expect(buttons.map((b) => b.callback_data)).toEqual(['fb:re:42', 'fb:skip:42']);
  });

  it('превью экранирует черновик и предлагает Отправить/Отмена', () => {
    expect(feedbackPreviewText('текст с <тегом>')).toContain('&lt;тегом&gt;');
    expect(feedbackPreviewButtons(42).map((b) => b.callback_data)).toEqual([
      'fb:send:42',
      'fb:cancel',
    ]);
  });
});
