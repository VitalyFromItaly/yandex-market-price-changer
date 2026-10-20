import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { Markup } from 'telegraf';

import { UserAccessService } from '../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { AiError } from '../../../ai/ai.errors';
import { PolzaApiError } from '../../../ai/polza.errors';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { FeedbackDraftService } from '../../../yandex/feedback/feedback-draft.service';
import {
  FEEDBACK_DRAFT_GONE_PLAIN,
  feedbackDraftButtons,
  feedbackDraftLostText,
  feedbackDraftProblemText,
  feedbackErrorText,
  feedbackPreviewButtons,
  feedbackPreviewText,
} from '../../../yandex/feedback/feedback-message';
import { FeedbackGoneError } from '../../../yandex/feedback/feedback.domain';
import { BotRegistry } from '../../bots/bot-registry.service';
import { esc, htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Полезная нагрузка «✨ Предложить ответ». Без токена (креды перечитываются
 * из Mongo) и без текста отзыва: он перечитывается с Маркета по id.
 */
export interface IFeedbackDraftJob {
  /** Числовой id бота (`ctx.botInfo.id`) — ключ BotRegistry.findByTelegramId. */
  botId: number;
  chatId: string;
  telegramUserId: string;
  feedbackId: number;
  /** Открыта ли фича `ai` — снимком на момент нажатия (админ — true). */
  aiAllowed: boolean;
}

type TButtons = Array<{ text: string; callback_data: string }>;

/**
 * Черновик ответа на отзыв от ИИ в фоне — вне цикла апдейтов telegraf: ответ
 * Polza бывал 68 с, а polling-цикл не забирает новые апдейты, пока не
 * завершены текущие, — бот молчал бы для всех.
 *
 * Черновик НЕ публикуется: он ложится в `feedbackDraft` и показывается прежним
 * превью «✅ Отправить / ❌ Отмена» — наружу его отправит только кнопка.
 *
 * Очередь reports, attempts: 1 — повтор жжёт деньги на Polza. @OnQueueFailed
 * не объявлен: он уже есть у ReportsProcessor на этой очереди.
 */
@Processor(QUEUE_NAMES.REPORTS)
export class FeedbackDraftProcessor {
  private readonly logger = new Logger(FeedbackDraftProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly stores: YandexMarketService,
    private readonly access: UserAccessService,
    private readonly drafts: FeedbackDraftService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_FEEDBACK_DRAFT)
  async run(job: Job<IFeedbackDraftJob>): Promise<void> {
    const { botId, chatId, telegramUserId, feedbackId, aiAllowed } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — черновик ответа не собран`);
      return;
    }
    const send = (text: string, buttons?: TButtons) =>
      bot.telegraf.telegram.sendMessage(
        chatId,
        text,
        htmlOptions(
          buttons
            ? {
                reply_markup: Markup.inlineKeyboard(
                  buttons.map((button) =>
                    Markup.button.callback(button.text, button.callback_data),
                  ),
                ).reply_markup,
              }
            : {},
        ),
      );

    try {
      const store = await this.stores.findByTelegramUser(telegramUserId);
      if (!store) {
        await send('⚠️ Настройки магазина не найдены — черновик не собран.');
        return;
      }

      const draft = await this.drafts.draft(store, { telegramUserId, aiAllowed, feedbackId });
      if (draft.problem) {
        // Вопрос остаётся открытым: продавец пришлёт свой текст или нажмёт ещё раз.
        await send(
          feedbackDraftProblemText(draft.problem, draft.text),
          feedbackDraftButtons(feedbackId),
        );
        return;
      }

      const saved = await this.access.setFeedbackDraftIfPending(
        telegramUserId,
        String(botId),
        String(feedbackId),
        draft.text,
      );
      if (!saved) {
        await send(feedbackDraftLostText());
        return;
      }
      await send(feedbackPreviewText(draft.text, true), feedbackPreviewButtons(feedbackId));
    } catch (error) {
      await this.fail(error, job.data, send);
    }
  }

  /**
   * Отказ ИИ (фича, лимит, ИИ выключен) — не сбой: продавцу его текст, админам
   * ничего. Сбой Polza `AiService` уже отрепортил — только текст. Остальное —
   * наша поломка: в журнал и общий текст. Не пробрасываем (attempts: 1).
   */
  private async fail(
    error: unknown,
    job: IFeedbackDraftJob,
    send: (text: string) => Promise<unknown>,
  ): Promise<void> {
    let text: string;
    if (error instanceof AiError || error instanceof PolzaApiError) {
      text = `⚠️ ${esc(error.userMessage)}`;
    } else if (error instanceof FeedbackGoneError) {
      text = `ℹ️ ${FEEDBACK_DRAFT_GONE_PLAIN}`;
    } else {
      void this.errors.report({
        error,
        source: 'queue',
        context: 'feedback-draft',
        telegramUserId: job.telegramUserId,
        chatId: job.chatId,
        botId: String(job.botId),
        action: 'черновик ответа на отзыв',
      });
      text = feedbackErrorText();
    }

    try {
      await send(text);
    } catch {
      // Не смогли ответить (типовое — 403): сбой уже в журнале или он не наш.
    }
  }
}
