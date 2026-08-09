import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FB_CB_CANCEL,
  fbReplyCallback,
  fbSendCallback,
  fbSkipCallback,
  parseFbCallback,
  parseGoodsFeedback,
} from '../../src/modules/yandex/feedback/feedback.domain';

describe('Отзывы: разбор ответа', () => {
  it('собирает поля из identifiers/description/statistics', () => {
    const feedback = parseGoodsFeedback({
      feedbackId: 123,
      createdAt: '2026-08-01T10:00:00+03:00',
      author: 'Иван',
      identifiers: { orderId: 555 },
      description: { advantages: 'Красивые', disadvantages: 'Дорогие', comment: 'Ок' },
      statistics: { rating: 4 },
    });

    expect(feedback).toMatchObject({
      feedbackId: 123,
      author: 'Иван',
      orderId: 555,
      rating: 4,
      advantages: 'Красивые',
    });
  });

  it('без feedbackId отзыв отбрасывается — ответить нечем', () => {
    expect(parseGoodsFeedback({} as never)).toBeNull();
  });
});

describe('Отзывы: кодек кнопок', () => {
  it('re/skip/send несут feedbackId', () => {
    expect(parseFbCallback(fbReplyCallback(9))).toEqual({ action: 're', feedbackId: 9 });
    expect(parseFbCallback(fbSkipCallback(9))).toEqual({ action: 'skip', feedbackId: 9 });
    expect(parseFbCallback(fbSendCallback(9))).toEqual({ action: 'send', feedbackId: 9 });
  });

  it('cancel — без идентификатора', () => {
    expect(parseFbCallback(FB_CB_CANCEL)).toEqual({ action: 'cancel' });
  });

  it('мусор не разбирается', () => {
    expect(parseFbCallback('fb:re:abc')).toBeNull();
    expect(parseFbCallback('fb:xxx')).toBeNull();
    expect(parseFbCallback(undefined)).toBeNull();
  });
});

describe('Место ответа на отзыв в pending-цепочке', () => {
  it('handlePendingReply зовётся ПОСЛЕДНИМ из pending-проверок', () => {
    // Три соседних вопроса принимают только числа/дату/время, а ответ на отзыв
    // — ЛЮБОЙ текст: поставленный раньше, он глотал бы их ответы. Инвариант не
    // ловится ни компилятором, ни рантаймом — закрепляем по исходнику, как
    // menu-labels.
    const src = readFileSync(
      join(
        process.cwd(),
        'src/modules/telegram/bots/price-changer-bot/handlers/api-settings.handler.ts',
      ),
      'utf8',
    );

    const reply = src.indexOf('feedbackHandler.handlePendingReply');
    expect(reply).toBeGreaterThan(src.indexOf('this.handlePendingRate(ctx, text)'));
    expect(reply).toBeGreaterThan(src.indexOf('reportsHandler.handlePendingDay'));
    expect(reply).toBeGreaterThan(src.indexOf('scheduleHandler.handlePendingTime'));
  });
});
