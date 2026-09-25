import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { cardsEmptyText, cardsErrorText, cardsText } from '../../../yandex/cards/cards-message';
import { CardsService } from '../../../yandex/cards/cards.service';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions, splitMessage } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/** Payload без токена — креды перечитываются из Mongo (довод IStockSyncJob). */
export interface IOfferCardsJob {
  botId: number;
  chatId: string;
  telegramUserId: string;
}

/**
 * Сводка по карточкам в фоне (довод price-recommendations.processor: полный
 * обход каталога — десятки секунд).
 *
 * @OnQueueFailed НЕ объявлен — он уже есть у ReportsProcessor на этой очереди.
 */
@Processor(QUEUE_NAMES.REPORTS)
export class OfferCardsProcessor {
  private readonly logger = new Logger(OfferCardsProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly cards: CardsService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_OFFER_CARDS)
  async run(job: Job<IOfferCardsJob>): Promise<void> {
    const { botId, chatId, telegramUserId } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — сводка по карточкам не собрана`);
      return;
    }

    try {
      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      if (!store) {
        await bot.telegraf.telegram.sendMessage(
          chatId,
          '⚠️ Настройки магазина не найдены — сводка не собрана. Откройте «⚙️ Настройки» и подключите магазин.',
          htmlOptions(),
        );
        return;
      }

      // Загрузка, сводка и книга — общие с CRM (CardsService). Момент среза в
      // отчёте один на текст и имя файла.
      const { summary, takenAt, workbook } = await this.cards.build(store);

      if (!workbook) {
        await bot.telegraf.telegram.sendMessage(chatId, cardsEmptyText(), htmlOptions());
        return;
      }

      for (const chunk of splitMessage(cardsText(summary, takenAt))) {
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
        context: 'offer-cards',
        telegramUserId,
        chatId,
        botId: String(botId),
        action: 'сводка по карточкам',
      });

      try {
        await bot.telegraf.telegram.sendMessage(chatId, cardsErrorText(), htmlOptions());
      } catch {
        // Не смогли ответить (типовое — 403): сбой уже в журнале.
      }
    }
  }
}
