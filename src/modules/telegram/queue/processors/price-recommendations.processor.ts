import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import {
  recommendationsEmptyText,
  recommendationsErrorText,
  recommendationsFileName,
  recommendationsText,
} from '../../../yandex/recommendations/recommendations-message';
import { buildRecommendationsWorkbook } from '../../../yandex/recommendations/recommendations-workbook';
import { YandexClientFactory } from '../../../yandex/yandex-client.factory';
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
    private readonly clients: YandexClientFactory,
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

      const rows = await this.clients.forStore(store).loadPriceRecommendations();

      if (!rows.length) {
        await bot.telegraf.telegram.sendMessage(chatId, recommendationsEmptyText(), htmlOptions());
        return;
      }

      // Момент среза один на текст и имя файла — иначе подпись и файл могли бы
      // разойтись на минуту через границу суток.
      const takenAt = new Date();

      for (const chunk of splitMessage(recommendationsText(rows, takenAt))) {
        await bot.telegraf.telegram.sendMessage(chatId, chunk, htmlOptions());
      }

      const workbook = buildRecommendationsWorkbook(rows);
      await bot.telegraf.telegram.sendDocument(chatId, {
        source: workbook.buffer,
        filename: recommendationsFileName(takenAt),
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
