import type { IGoodsFeedback } from './feedback.domain';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';
import type { IPagedResult } from '../yandex-api.client';

import { Injectable } from '@nestjs/common';

import { YandexClientFactory } from '../yandex-client.factory';

import { FeedbackReplyInvalidError, feedbackReplyProblem } from './feedback.domain';

/**
 * Отзывы о товарах — ядро на оба канала: список ждущих реакции, ответ и
 * «прочитано».
 *
 * Магазин приходит готовым: бот передаёт активный, CRM — перекрытый ключом из
 * адреса (`StoresService.resolve`). Черновики, pending-вопросы и отрисовка —
 * забота каналов, не сервиса.
 *
 * Обе записи идут через `postWrite` клиента, без повторов: повтор вслепую при
 * 5xx мог бы опубликовать два одинаковых публичных комментария.
 *
 * Имя — не `GoodsFeedbackService`: такой класс есть в сгенерированном
 * (мёртвом) клиенте `src/modules/yandex/api/services/`.
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly clients: YandexClientFactory) {}

  /** ОДНА страница отзывов без ответа (отзывы бизнесовые, не магазинные). */
  async listNeedingReaction(store: YandexMarketDocument): Promise<IPagedResult<IGoodsFeedback>> {
    return this.clients.forStore(store).getFeedbacksNeedingReaction();
  }

  /**
   * Опубликовать ответ — ПУБЛИЧНЫЙ текст на Маркете. Проверка длины здесь —
   * последний барьер: каналы проверяют раньше, но новый путь записи не должен
   * суметь отправить Маркету то, на что он ответит 400.
   */
  async reply(store: YandexMarketDocument, feedbackId: number, text: string): Promise<void> {
    const problem = feedbackReplyProblem(text);
    if (problem) throw new FeedbackReplyInvalidError(problem);
    await this.clients.forStore(store).updateFeedbackComment(feedbackId, text);
  }

  /** Пометить отзывы прочитанными без ответа. */
  async skip(store: YandexMarketDocument, feedbackIds: readonly number[]): Promise<void> {
    if (!feedbackIds.length) return;
    await this.clients.forStore(store).skipFeedbackReaction(feedbackIds);
  }
}
