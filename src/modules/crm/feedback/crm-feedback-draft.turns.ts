import type { ICrmFeedbackDraft } from './crm-feedback.domain';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { IFeedbackDraftAsk } from '../../yandex/feedback/feedback-draft.service';

import { Injectable } from '@nestjs/common';

import { ErrorReporter } from '../../errors/error-reporter.service';
import { FeedbackDraftService } from '../../yandex/feedback/feedback-draft.service';
import { FeedbackGoneError } from '../../yandex/feedback/feedback.domain';
import { InMemoryTurns } from '../crm-turns';

import { CRM_FEEDBACK_DRAFT_GONE, toCrmFeedbackDraft } from './crm-feedback.domain';

export interface IFeedbackDraftTurnInput extends IFeedbackDraftAsk {
  store: YandexMarketDocument;
}

/**
 * Ходы «✨ Предложить ответ» (TASK-167) — та же механика в памяти, что у
 * ИИ-аналитика (решение `feedback_ai_draft_in_memory`): черновик — ответ ИИ,
 * его текст на сервере не хранится (правило TASK-104), а Polza думает до минуты
 * — синхронный POST оборвал бы прокси.
 *
 * «Отзыв уже обработан» — не сбой хода, а ответ `gone`: фронт закрывает диалог
 * так же, как при 409 на публикации.
 */
@Injectable()
export class FeedbackDraftTurns extends InMemoryTurns<IFeedbackDraftTurnInput, ICrmFeedbackDraft> {
  constructor(
    private readonly drafts: FeedbackDraftService,
    errors: ErrorReporter,
  ) {
    super(errors, 'crm:feedback-draft');
  }

  protected async run(input: IFeedbackDraftTurnInput): Promise<ICrmFeedbackDraft> {
    try {
      const draft = await this.drafts.draft(input.store, {
        telegramUserId: input.telegramUserId,
        aiAllowed: input.aiAllowed,
        feedbackId: input.feedbackId,
      });
      return toCrmFeedbackDraft(draft);
    } catch (error) {
      if (error instanceof FeedbackGoneError) return CRM_FEEDBACK_DRAFT_GONE;
      throw error;
    }
  }
}
