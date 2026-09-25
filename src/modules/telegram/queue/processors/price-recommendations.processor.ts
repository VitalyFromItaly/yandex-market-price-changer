import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import {
  recommendationsEmptyText,
  recommendationsErrorText,
  recommendationsText,
} from '../../../yandex/recommendations/recommendations-message';
import { RecommendationsService } from '../../../yandex/recommendations/recommendations.service';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions, splitMessage } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/** Payload без токена — креды перечитываются из Mongo (довод IStockSyncJob). */
export interface IPriceRecommendationsJob {
  botId: number;
  chatId: string;
  telegramUserId: string;
}

/**
 * Сборка рекомендаций по ценам в фоне (довод fby-overview.processor: два
 * прохода по методу с квотой 100/мин — десятки секунд).
 *
 * @OnQueueFailed НЕ объявлен — он уже есть у ReportsProcessor на этой очереди.
 */
@Processor(QUEUE_NAMES.REPORTS)
export class PriceRecommendationsProcessor {
  private readonly logger = new Logger(PriceRecommendationsProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly recommendations: RecommendationsService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_PRICE_RECOMMENDATIONS)
  async run(job: Job<IPriceRecommendationsJob>): Promise<void> {
    const { botId, chatId, telegramUserId } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — рекомендации не собраны`);
      return;
    }

    try {
      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      if (!store) {
        await bot.telegraf.telegram.sendMessage(
          chatId,
          '⚠️ Настройки магазина не найдены — рекомендации не собраны. Откройте «⚙️ Настройки» и подключите магазин.',
          htmlOptions(),
        );
        return;
      }

      // Загрузка, порядок и книга — общие с CRM (RecommendationsService).
      // Момент среза в отчёте один на текст и имя файла.
      const { rows, takenAt, workbook } = await this.recommendations.build(store);

      if (!workbook) {
        await bot.telegraf.telegram.sendMessage(chatId, recommendationsEmptyText(), htmlOptions());
        return;
      }

      for (const chunk of splitMessage(recommendationsText(rows, takenAt))) {
        await bot.telegraf.telegram.sendMessage(chatId, chunk, htmlOptions());
      }

      await bot.telegraf.telegram.sendDocument(chatId, {
        source: workbook.buffer,
        filename: workbook.filename,
      });
    } catch (error) {
      // Ошибку гасим, НЕ пробрасываем (attempts: 1) — но продавец ждёт экран.
      void this.errors.report({
        error,
        source: 'queue',
        context: 'price-recommendations',
        telegramUserId,
        chatId,
        botId: String(botId),
        action: 'рекомендации по ценам',
      });

      try {
        await bot.telegraf.telegram.sendMessage(chatId, recommendationsErrorText(), htmlOptions());
      } catch {
        // Не смогли ответить (типовое — 403): сбой уже в журнале.
      }
    }
  }
}
