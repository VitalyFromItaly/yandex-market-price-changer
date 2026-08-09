import type { IPriceRecommendationsJob } from '../../../queue/processors/price-recommendations.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { Context } from 'telegraf';

import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import {
  recommendationsErrorText,
  recommendationsQueuedAlreadyText,
  recommendationsQueuedText,
} from '../../../../yandex/recommendations/recommendations-message';
import { htmlOptions } from '../../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../../index';
import { isQueuedFor } from '../../../queue/queued-for-user';
import { StorePromptService } from '../../shared/services/store-prompt.service';

/**
 * Экран «🎯 Рекомендации цен»: какие товары дороже «привлекательной» цены
 * Маркета и на сколько. Сводка + топ худших + полный xlsx.
 *
 * Хендлер только проверяет и ставит джобу: два постраничных прохода по методу
 * с квотой 100 запросов в минуту — десятки секунд на большом каталоге, и
 * ожидание в хендлере стопорило бы polling-цикл telegraf (довод fby).
 * Inline-кнопок у экрана нет — шаг в композере не нужен.
 */
@Injectable()
export class PriceRecommendationsHandler {
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
      if (isQueuedFor(jobs, JOB_TYPES.SEND_PRICE_RECOMMENDATIONS, telegramUserId)) {
        await ctx.reply(recommendationsQueuedAlreadyText());
        return;
      }

      const store = await this.stores.findByTelegramUser(telegramUserId);
      if (!store) {
        await this.storePrompt.replyNeedsStore(ctx);
        return;
      }

      const payload: IPriceRecommendationsJob = {
        botId: ctx.botInfo.id,
        chatId: ctx.chat.id.toString(),
        telegramUserId,
      };
      await this.queue.add(JOB_TYPES.SEND_PRICE_RECOMMENDATIONS, payload);

      await ctx.reply(recommendationsQueuedText());
    } catch (error) {
      void this.errors.report({
        error,
        source: 'bot',
        context: 'price-recommendations',
        telegramUserId: ctx.from?.id?.toString(),
        username: ctx.from?.username,
        chatId: ctx.chat?.id?.toString(),
        botId: ctx.botInfo?.id?.toString(),
        action: 'рекомендации по ценам',
      });

      await ctx.reply(recommendationsErrorText(), htmlOptions());
    }
  }
}
