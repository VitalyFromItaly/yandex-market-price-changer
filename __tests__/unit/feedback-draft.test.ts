import type { IChatCompletionResult } from '../../src/modules/ai/polza.client';
import type { IGoodsFeedback } from '../../src/modules/yandex/feedback/feedback.domain';

import { describe, expect, it, vi } from 'vitest';

import { AiDailyLimitError, AiFeatureDisabledError } from '../../src/modules/ai/ai.errors';
import { AiService } from '../../src/modules/ai/ai.service';
import { PolzaInsufficientFundsError } from '../../src/modules/ai/polza.errors';
import { FeedbackHandler } from '../../src/modules/telegram/bots/price-changer-bot/handlers/feedback.handler';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { JOB_TYPES } from '../../src/modules/telegram/index';
import { FeedbackDraftTurns } from '../../src/modules/crm/feedback/crm-feedback-draft.turns';
import { FEEDBACK_GONE_TEXT } from '../../src/modules/crm/feedback/crm-feedback.domain';
import { FeedbackDraftProcessor } from '../../src/modules/telegram/queue/processors/feedback-draft.processor';
import {
  FEEDBACK_DRAFT_PURPOSE,
  feedbackDraftPrompt,
  toFeedbackDraftMessages,
} from '../../src/modules/yandex/feedback/feedback-draft.domain';
import { FeedbackDraftService } from '../../src/modules/yandex/feedback/feedback-draft.service';
import {
  FeedbackGoneError,
  FEEDBACK_REPLY_MAX_LENGTH,
} from '../../src/modules/yandex/feedback/feedback.domain';

const FEEDBACK: IGoodsFeedback = {
  feedbackId: 77,
  rating: 2,
  advantages: 'Красивый ремешок',
  disadvantages: 'Стекло поцарапано',
  comment: 'Секретная жалоба покупателя',
};

const STORE = { telegramUserId: 'u1' } as never;

const result = (content: string): IChatCompletionResult => ({
  content,
  toolCalls: [],
  finishReason: 'stop',
  usage: {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cachedTokens: 0,
    reasoningTokens: 0,
    costRub: 0.01,
  },
  model: 'm',
  provider: 'p',
  traceId: 't',
});

/** Настоящий AiService на фейках — барьеры и учёт работают как в проде. */
function drafter(items: IGoodsFeedback[] = [FEEDBACK]) {
  const chatCompletion = vi.fn().mockResolvedValue(result('Спасибо за отзыв! Нам жаль.'));
  const usage = { record: vi.fn(), spentRubSince: vi.fn().mockResolvedValue(0) };
  const config = {
    polzaAiEnabled: true,
    polzaAiModel: 'm',
    polzaAiModelFor: () => 'm',
    aiUserDailyLimitRub: 50,
  };
  const errors = { report: vi.fn() };
  const ai = new AiService(
    { chatCompletion } as never,
    usage as never,
    config as never,
    errors as never,
  );
  const feedback = {
    listNeedingReaction: vi.fn().mockResolvedValue({ items }),
    reply: vi.fn(),
    skip: vi.fn(),
  };
  const service = new FeedbackDraftService(feedback as never, ai);
  return { service, chatCompletion, usage, feedback, errors };
}

const ASK = { telegramUserId: 'u1', aiAllowed: true, feedbackId: 77 };

describe('Черновик ответа на отзыв: промпт', () => {
  it('запрещает обещания, споры, конкурентов, цены и выдуманные характеристики', () => {
    const prompt = feedbackDraftPrompt();
    for (const word of [
      'возврат денег',
      'замену',
      'компенсацию',
      'спорить',
      'обвинять',
      'конкурентов',
      'цены',
      'характеристики',
    ]) {
      expect(prompt).toContain(word);
    }
    expect(prompt).toMatch(/не больше \d+ символов/);
  });

  it('отзыв — отдельным сообщением: оценка и три поля', () => {
    const [system, user] = toFeedbackDraftMessages(FEEDBACK);
    expect(system).toMatchObject({ role: 'system', content: feedbackDraftPrompt() });
    expect(user.content).toContain('Оценка: 2 из 5');
    expect(user.content).toContain('Стекло поцарапано');
  });

  it('отзыв без текста — так и сказано, а не пустые поля', () => {
    const [, user] = toFeedbackDraftMessages({ feedbackId: 1, rating: 5 });
    expect(user.content).toContain('только оценка');
  });
});

describe('FeedbackDraftService', () => {
  it('один запрос с purpose feedback-reply, черновик проходит feedbackReplyProblem', async () => {
    const { service, chatCompletion, usage } = drafter();
    const draft = await service.draft(STORE, ASK);

    expect(draft).toEqual({ text: 'Спасибо за отзыв! Нам жаль.', problem: null });
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(chatCompletion.mock.calls[0][0].tools).toBeUndefined();
    expect(usage.record.mock.calls[0][0].purpose).toBe(FEEDBACK_DRAFT_PURPOSE);
    expect(FEEDBACK_DRAFT_PURPOSE).toBe('feedback-reply');
  });

  it('никогда не публикует: FeedbackService.reply не вызывается', async () => {
    const { service, feedback } = drafter();
    await service.draft(STORE, ASK);
    expect(feedback.reply).not.toHaveBeenCalled();
    expect(feedback.skip).not.toHaveBeenCalled();
  });

  it('в строке AiUsage нет ни текста отзыва, ни ответа (TASK-104)', async () => {
    const { service, usage } = drafter();
    await service.draft(STORE, ASK);
    const dump = JSON.stringify(usage.record.mock.calls[0][0]);
    expect(dump).not.toContain('Секретная жалоба');
    expect(dump).not.toContain('Спасибо за отзыв');
  });

  it('длинный черновик не обрезается — problem too-long', async () => {
    const { service, chatCompletion } = drafter();
    const long = 'а'.repeat(FEEDBACK_REPLY_MAX_LENGTH + 1);
    chatCompletion.mockResolvedValue(result(long));
    expect(await service.draft(STORE, ASK)).toEqual({ text: long, problem: 'too-long' });
  });

  it('пустой ответ модели — problem empty', async () => {
    const { service, chatCompletion } = drafter();
    chatCompletion.mockResolvedValue(result('   '));
    expect(await service.draft(STORE, ASK)).toEqual({ text: '', problem: 'empty' });
  });

  it('ИИ закрыт — отказ до Маркета и до Polza, строк учёта нет', async () => {
    const { service, chatCompletion, usage, feedback } = drafter();
    await expect(service.draft(STORE, { ...ASK, aiAllowed: false })).rejects.toBeInstanceOf(
      AiFeatureDisabledError,
    );
    expect(feedback.listNeedingReaction).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });

  it('отзыва нет среди ждущих — FeedbackGoneError, модель не зовётся', async () => {
    const { service, chatCompletion } = drafter([]);
    await expect(service.draft(STORE, ASK)).rejects.toBeInstanceOf(FeedbackGoneError);
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});

describe('FeedbackDraftProcessor (бот, очередь reports)', () => {
  function processor(draft: () => Promise<unknown>, pendingOk = true) {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const registry = { findByTelegramId: () => ({ telegraf: { telegram: { sendMessage } } }) };
    const stores = { findByTelegramUser: vi.fn().mockResolvedValue({}) };
    const access = { setFeedbackDraftIfPending: vi.fn().mockResolvedValue(pendingOk) };
    const errors = { report: vi.fn() };
    const drafts = { draft: vi.fn(draft) };
    const p = new FeedbackDraftProcessor(
      registry as never,
      stores as never,
      access as never,
      drafts as never,
      errors as never,
    );
    const job = {
      data: { botId: 1, chatId: 'c1', telegramUserId: 'u1', feedbackId: 77, aiAllowed: true },
    };
    return { run: () => p.run(job as never), sendMessage, access, errors };
  }

  const markupOf = (call: unknown[]) =>
    JSON.stringify((call[2] as { reply_markup?: unknown }).reply_markup ?? null);

  it('черновик ложится в черновик вопроса и приходит прежним превью «Отправить»', async () => {
    const { run, sendMessage, access } = processor(async () => ({
      text: 'Спасибо!',
      problem: null,
    }));
    await run();
    expect(access.setFeedbackDraftIfPending).toHaveBeenCalledWith('u1', '1', '77', 'Спасибо!');
    const [call] = sendMessage.mock.calls;
    expect(call[1]).toContain('Спасибо!');
    expect(call[1]).toContain('черновик ИИ');
    expect(markupOf(call)).toContain('fb:send:77');
  });

  it('вопрос закрыли, пока модель думала — превью нет', async () => {
    const { run, sendMessage } = processor(
      async () => ({ text: 'Спасибо!', problem: null }),
      false,
    );
    await run();
    expect(sendMessage.mock.calls[0][1]).toContain('Черновик не найден');
    expect(markupOf(sendMessage.mock.calls[0])).not.toContain('fb:send');
  });

  it('длинный черновик — без превью и без записи, кнопка «ещё раз»', async () => {
    const { run, sendMessage, access } = processor(async () => ({
      text: 'x',
      problem: 'too-long',
    }));
    await run();
    expect(access.setFeedbackDraftIfPending).not.toHaveBeenCalled();
    expect(markupOf(sendMessage.mock.calls[0])).toContain('fb:ai:77');
    expect(markupOf(sendMessage.mock.calls[0])).not.toContain('fb:send');
  });

  it('отказ ИИ — его userMessage, без алерта', async () => {
    const { run, sendMessage, errors } = processor(async () => {
      throw new AiDailyLimitError(50, 50);
    });
    await run();
    expect(sendMessage.mock.calls[0][1]).toContain(
      new AiDailyLimitError(50, 50).userMessage.slice(0, 10),
    );
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('сбой Polza — его текст, повторного репорта нет (его сделал AiService)', async () => {
    const error = new PolzaInsufficientFundsError('нет денег', 402, 'INSUFFICIENT_BALANCE', 't');
    const { run, sendMessage, errors } = processor(async () => {
      throw error;
    });
    await run();
    expect(sendMessage.mock.calls[0][1]).toContain(error.userMessage.slice(0, 10));
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('неизвестная ошибка — в журнал и общий текст, наружу не летит', async () => {
    const { run, errors } = processor(async () => {
      throw new Error('boom');
    });
    await expect(run()).resolves.toBeUndefined();
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'feedback-draft' }),
    );
  });
});

describe('FeedbackDraftTurns (CRM, ход в памяти)', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('готовый ход — текст и сообщение о проблеме; отзыв пропал — gone', async () => {
    const drafts = {
      draft: vi
        .fn()
        .mockResolvedValueOnce({ text: 'x'.repeat(5000), problem: 'too-long' })
        .mockRejectedValueOnce(new FeedbackGoneError(77)),
    };
    const turns = new FeedbackDraftTurns(drafts as never, { report: vi.fn() } as never);
    const input = { telegramUserId: 'u1', aiAllowed: true, feedbackId: 77, store: STORE };

    const first = turns.start(input);
    await settle();
    const done = turns.view('u1', first);
    expect(done.status).toBe('done');
    expect(done.answer).toMatchObject({ gone: false });
    expect(done.answer.message).toContain(String(FEEDBACK_REPLY_MAX_LENGTH));

    const second = turns.start(input);
    await settle();
    expect(turns.view('u1', second).answer).toEqual({
      text: '',
      gone: true,
      message: FEEDBACK_GONE_TEXT,
    });
  });
});

describe('FeedbackHandler: «✨ Предложить ответ» в боте', () => {
  function handler(account: Record<string, unknown> | null, queued: unknown[] = []) {
    const queue = { getJobs: vi.fn().mockResolvedValue(queued), add: vi.fn() };
    const access = {
      findByUserAndBot: vi.fn().mockResolvedValue(account),
      setPendingFeedbackReply: vi.fn().mockResolvedValue(account),
    };
    const feedback = { reply: vi.fn() };
    const keyboard = {
      createInlineButtons: async (buttons: unknown) => ({
        reply_markup: { inline_keyboard: [buttons] },
      }),
    };
    const h = new FeedbackHandler(
      {} as never,
      access as never,
      feedback as never,
      keyboard as never,
      {} as never,
      { report: vi.fn() } as never,
      queue as never,
    );
    let action: (ctx: unknown) => Promise<void>;
    h.registerCallbacks({ action: (_: unknown, fn: typeof action) => (action = fn) } as never);
    const reply = vi.fn();
    const press = (data: string) =>
      action({
        callbackQuery: { data },
        answerCbQuery: vi.fn(),
        reply,
        from: { id: 5 },
        botInfo: { id: 9 },
        chat: { id: 5 },
      });
    return { press, reply, queue, feedback };
  }

  const features = {
    [FEATURE.GOODS_FEEDBACK]: true,
    [FEATURE.AI]: true,
    [FEATURE.FEEDBACK_AI_REPLY]: true,
  };

  it('ставит задачу в reports и отвечает сразу — модель в хендлере не ждётся', async () => {
    const { press, reply, queue, feedback } = handler({ pendingFeedbackReply: '77', features });
    await press('fb:ai:77');
    expect(queue.add).toHaveBeenCalledWith(JOB_TYPES.SEND_FEEDBACK_DRAFT, {
      botId: 9,
      chatId: '5',
      telegramUserId: '5',
      feedbackId: 77,
      aiAllowed: true,
    });
    expect(reply.mock.calls[0][0]).toContain('Готовлю черновик');
    expect(feedback.reply).not.toHaveBeenCalled();
  });

  it('кнопка не своего вопроса — без задачи', async () => {
    const { press, reply, queue } = handler({ pendingFeedbackReply: '12', features });
    await press('fb:ai:77');
    expect(queue.add).not.toHaveBeenCalled();
    expect(reply.mock.calls[0][0]).toContain('Черновик не найден');
  });

  it('двойной тап — вторая задача не ставится', async () => {
    const queued = [{ name: JOB_TYPES.SEND_FEEDBACK_DRAFT, data: { telegramUserId: '5' } }];
    const { press, queue } = handler({ pendingFeedbackReply: '77', features }, queued);
    await press('fb:ai:77');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('«Ответить»: кнопка «✨» только при открытой фиче', async () => {
    const open = handler({ features });
    await open.press('fb:re:77');
    expect(JSON.stringify(open.reply.mock.calls[0][1])).toContain('fb:ai:77');

    const closed = handler({ features: { [FEATURE.GOODS_FEEDBACK]: true } });
    await closed.press('fb:re:77');
    expect(closed.reply.mock.calls[0][1]).toBeUndefined();
  });
});
