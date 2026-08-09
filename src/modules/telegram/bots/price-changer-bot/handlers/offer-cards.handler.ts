import type { IOfferCardsJob } from '../../../queue/processors/offer-cards.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import {
  cardsErrorText,
  cardsQueuedAlreadyText,
  cardsQueuedText,
} from '../../../../yandex/cards/cards-message';
import { htmlOptions } from '../../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../../index';
import { isQueuedFor } from '../../../queue/queued-for-user';
import { StorePromptService } from '../../shared/services/store-prompt.service';

/**
 * Экран «🪪 Карточки»: заполненность карточек товаров — статусы, рейтинг
 * против категорийного ориентира, слабые карточки с рекомендациями Маркета.
 *
 * Калька price-recommendations.handler: хендлер только проверяет и ставит
 * джобу — полный обход offer-cards на большом каталоге занимает десятки
 * секунд, а ожидание в хендлере стопорило бы polling-цикл telegraf для всех.
 * Inline-кнопок у экрана нет — шаг в композере не нужен.
 */
@Injectable()
export class OfferCardsHandler {
  constructor(
    private readonly stores: YandexMarketService,
    private readonly storePrompt: StorePromptService,
    private readonly errors: ErrorReporter,
    @InjectQueue(QUEUE_NAMES.REPORTS) private readonly queue: Queue,
  ) {}

  public async handle(ctx: Context): Promise<void> {
    try {
      const telegramUserId = ctx.from.id.toString();

      const jobs = await this.queue.getJobs(['waiting', 'active']);
      if (isQueuedFor(jobs, JOB_TYPES.SEND_OFFER_CARDS, telegramUserId)) {
        await ctx.reply(cardsQueuedAlreadyText());
        return;
      }

      const store = await this.stores.findByTelegramUser(telegramUserId);
      if (!store) {
        await this.storePrompt.replyNeedsStore(ctx);
        return;
      }

      const payload: IOfferCardsJob = {
        botId: ctx.botInfo.id,
        chatId: ctx.chat.id.toString(),
        telegramUserId,
      };
      await this.queue.add(JOB_TYPES.SEND_OFFER_CARDS, payload);

      await ctx.reply(cardsQueuedText());
    } catch (error) {
      void this.errors.report({
        error,
        source: 'bot',
        context: 'offer-cards',
        telegramUserId: ctx.from?.id?.toString(),
        username: ctx.from?.username,
        chatId: ctx.chat?.id?.toString(),
        botId: ctx.botInfo?.id?.toString(),
        action: 'сводка по карточкам',
      });

      await ctx.reply(cardsErrorText(), htmlOptions());
    }
  }
}
