import { Injectable } from '@nestjs/common';
import { Context } from 'telegraf';

import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import {
  feedbackAskReplyText,
  feedbackCancelledText,
  feedbackCardButtons,
  feedbackCardText,
  feedbackDraftLostText,
  feedbackEmptyText,
  feedbackErrorText,
  feedbackHeaderText,
  feedbackPreviewButtons,
  feedbackPreviewText,
  feedbackSentText,
  feedbackSkippedText,
  feedbackTooLongText,
  FEEDBACK_SHOW_LIMIT,
} from '../../../../yandex/feedback/feedback-message';
import {
  FB_CB_PATTERN,
  FEEDBACK_REPLY_MAX_LENGTH,
  parseFbCallback,
} from '../../../../yandex/feedback/feedback.domain';
import { FeedbackService } from '../../../../yandex/feedback/feedback.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { StorePromptService } from '../../shared/services/store-prompt.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

/**
 * Экран «💬 Отзывы»: отзывы без ответа, ответ и «прочитано» из бота.
 *
 * Ответ на отзыв — ПУБЛИЧНЫЙ текст на Яндекс.Маркете, поэтому он никогда не
 * уходит сразу: текст сохраняется черновиком и показывается превью с кнопками
 * «Отправить/Отмена». Публикует только кнопка — случайное сообщение после
 * «Ответить» не должно улетать наружу (довод dryRun и STOCK_WRITE_ENABLED).
 *
 * Незакрытый вопрос «пришлите текст» живёт в `UserAccess.pendingFeedbackReply`
 * — четвёртое pending-поле. Его проверка в цепочке ApiSettingsHandler стоит
 * ПОСЛЕДНЕЙ: три соседних вопроса принимают только числа/дату/время, а этот —
 * любой текст, и, поставленный раньше, он глотал бы их ответы.
 */
@Injectable()
export class FeedbackHandler {
  constructor(
    private readonly stores: YandexMarketService,
    private readonly access: UserAccessService,
    private readonly feedback: FeedbackService,
    private readonly keyboard: PriceChangerKeyboard,
    private readonly storePrompt: StorePromptService,
    private readonly errors: ErrorReporter,
  ) {}

  /** Кнопка меню: показать отзывы без ответа. */
  public async handle(ctx: Context): Promise<void> {
    try {
      const store = await this.stores.findByTelegramUser(ctx.from.id.toString());
      if (!store) {
        await this.storePrompt.replyNeedsStore(ctx);
        return;
      }

      const page = await this.feedback.listNeedingReaction(store);
      if (!page.items.length) {
        await ctx.reply(feedbackEmptyText());
        return;
      }

      const shown = page.items.slice(0, FEEDBACK_SHOW_LIMIT);
      await ctx.reply(
        feedbackHeaderText(page.items.length, !!page.nextPageToken, shown.length),
        htmlOptions(),
      );

      // Каждый отзыв — отдельным сообщением со своими кнопками: у Telegram
      // одна inline-клавиатура на сообщение, а кнопки «Ответить/Прочитано»
      // должны стоять под СВОИМ отзывом, не в общем списке.
      for (const [index, feedback] of shown.entries()) {
        const keyboard = await this.keyboard.createInlineButtons(feedbackCardButtons(feedback));
        await ctx.reply(
          feedbackCardText(feedback, index + 1),
          htmlOptions({ reply_markup: keyboard.reply_markup }),
        );
      }
    } catch (error) {
      await this.replyWithError(ctx, error, 'отзывы');
    }
  }

  /** Кнопки отзывов. Регистрируются ДО общего callback_query — см. композер. */
  public registerCallbacks(bot: TTelegrafBot): void {
    bot.action(FB_CB_PATTERN, async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string }).data;
      const parsed = parseFbCallback(data);
      await ctx.answerCbQuery();
      if (!parsed) return;

      try {
        switch (parsed.action) {
          case 're':
            await this.askReply(ctx, parsed.feedbackId);
            return;
          case 'skip':
            await this.skip(ctx, parsed.feedbackId);
            return;
          case 'send':
            await this.send(ctx, parsed.feedbackId);
            return;
          case 'cancel':
            await this.cancel(ctx);
            return;
        }
      } catch (error) {
        await this.replyWithError(ctx, error, 'ответ на отзыв');
      }
    });
  }

  /**
   * Текст от продавца при открытом вопросе об ответе на отзыв. Зовётся из
   * ApiSettingsHandler ПОСЛЕДНИМ в pending-цепочке (см. шапку класса).
   *
   * @returns true, если сообщение было черновиком ответа и обработано здесь.
   */
  public async handlePendingReply(ctx: Context, text: string): Promise<boolean> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const account = await this.access.findByUserAndBot(telegramUserId, botId);
    const feedbackId = Number(account?.pendingFeedbackReply);
    if (!account?.pendingFeedbackReply || !Number.isFinite(feedbackId)) return false;

    if (text.length > FEEDBACK_REPLY_MAX_LENGTH) {
      // Вопрос остаётся открытым — продавец сокращает текст, не начиная заново.
      await ctx.reply(feedbackTooLongText(text.length));
      return true;
    }

    // Черновик, НЕ публикация: наружу текст уйдёт только кнопкой «Отправить».
    await this.access.setFeedbackDraft(telegramUserId, botId, text);

    const keyboard = await this.keyboard.createInlineButtons(feedbackPreviewButtons(feedbackId));
    await ctx.reply(
      feedbackPreviewText(text),
      htmlOptions({ reply_markup: keyboard.reply_markup }),
    );
    return true;
  }

  /** «✍️ Ответить»: открыть вопрос. Сброс других pending — внутри сеттера. */
  private async askReply(ctx: Context, feedbackId: number): Promise<void> {
    await this.access.setPendingFeedbackReply(
      ctx.from.id.toString(),
      ctx.botInfo.id.toString(),
      String(feedbackId),
    );
    await ctx.reply(feedbackAskReplyText());
  }

  /** «✅ Прочитано»: skip-reaction, вопросов не открывает. */
  private async skip(ctx: Context, feedbackId: number): Promise<void> {
    const store = await this.stores.findByTelegramUser(ctx.from.id.toString());
    if (!store) {
      await this.storePrompt.replyNeedsStore(ctx);
      return;
    }

    await this.feedback.skip(store, [feedbackId]);
    await ctx.reply(feedbackSkippedText());
  }

  /** «✅ Отправить» на превью: публикация черновика. Единственный путь наружу. */
  private async send(ctx: Context, feedbackId: number): Promise<void> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const account = await this.access.findByUserAndBot(telegramUserId, botId);
    const draft = account?.feedbackDraft;

    // Кнопка обязана публиковать ровно тот отзыв, под которым нарисована:
    // после рестарта или второго «Ответить» pending мог смениться.
    if (!draft || account?.pendingFeedbackReply !== String(feedbackId)) {
      await ctx.reply(feedbackDraftLostText());
      return;
    }

    const store = await this.stores.findByTelegramUser(telegramUserId);
    if (!store) {
      await this.storePrompt.replyNeedsStore(ctx);
      return;
    }

    await this.feedback.reply(store, feedbackId, draft);

    // Вопрос закрывается ПОСЛЕ успешной публикации: упавший запрос оставляет
    // черновик на месте, и продавец жмёт «Отправить» ещё раз, не набирая текст.
    await this.access.setPendingFeedbackReply(telegramUserId, botId, null);
    await ctx.reply(feedbackSentText());
  }

  /** «❌ Отмена» на превью: черновик и вопрос стираются, наружу ничего. */
  private async cancel(ctx: Context): Promise<void> {
    await this.access.setPendingFeedbackReply(
      ctx.from.id.toString(),
      ctx.botInfo.id.toString(),
      null,
    );
    await ctx.reply(feedbackCancelledText());
  }

  private async replyWithError(ctx: Context, error: unknown, action: string): Promise<void> {
    void this.errors.report({
      error,
      source: 'bot',
      context: 'feedback',
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action,
    });

    await ctx.reply(feedbackErrorText(), htmlOptions());
  }
}
