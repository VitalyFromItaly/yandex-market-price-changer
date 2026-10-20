import type { IFeedbackDraft } from './feedback-draft.domain';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { AiFeatureDisabledError } from '../../ai/ai.errors';
import { AiService } from '../../ai/ai.service';

import {
  FEEDBACK_DRAFT_MAX_TOKENS,
  FEEDBACK_DRAFT_PURPOSE,
  toFeedbackDraftMessages,
} from './feedback-draft.domain';
import { FeedbackGoneError, feedbackReplyProblem } from './feedback.domain';
import { FeedbackService } from './feedback.service';

export interface IFeedbackDraftAsk {
  telegramUserId: string;
  /** Открыта ли фича `ai` — готовым boolean (админ уже «всё открыто»). */
  aiAllowed: boolean;
  feedbackId: number;
}

/**
 * «✨ Предложить ответ» — черновик ответа на отзыв одним запросом к Polza, без
 * инструментов. Ядро на оба канала: бот зовёт из очереди reports, CRM — из
 * хода в памяти.
 *
 * Сервис НИКОГДА не публикует: `FeedbackService.reply` здесь не зовётся, текст
 * возвращается каналу, и наружу его отправляет только прежний шаг превью.
 *
 * Отзыв перечитывается с Маркета по id: в callback_data бота текст не влезает,
 * а тексту от веба верить незачем — промпт строится из того, что сказал Маркет.
 * Ответили, пока модель думала, — `FeedbackGoneError`.
 *
 * Ошибки ИИ (`AiError`, `PolzaApiError`) пролетают насквозь — их тексты
 * показывают каналы; сбой Polza уже отрепортил `AiService`.
 */
@Injectable()
export class FeedbackDraftService {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly ai: AiService,
  ) {}

  async draft(store: YandexMarketDocument, ask: IFeedbackDraftAsk): Promise<IFeedbackDraft> {
    // Отказ раньше похода на Маркет: закрытая функция не тратит его квоту.
    if (!ask.aiAllowed) throw new AiFeatureDisabledError();

    const page = await this.feedback.listNeedingReaction(store);
    const item = page.items.find((feedback) => feedback.feedbackId === ask.feedbackId);
    if (!item) throw new FeedbackGoneError(ask.feedbackId);

    const completion = await this.ai.complete(
      {
        telegramUserId: ask.telegramUserId,
        aiAllowed: ask.aiAllowed,
        purpose: FEEDBACK_DRAFT_PURPOSE,
      },
      { messages: toFeedbackDraftMessages(item), maxTokens: FEEDBACK_DRAFT_MAX_TOKENS },
    );

    // Не обрезаем: обрезанный ответ — чужой текст с оборванной фразой. Длинный
    // или пустой черновик каналы показывают с просьбой сгенерировать ещё раз.
    const text = completion.content?.trim() ?? '';
    return { text, problem: feedbackReplyProblem(text) };
  }
}
