import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { fbyOverviewErrorText } from '../../../yandex/fby/fby-message';
import { FbyService } from '../../../yandex/fby/fby.service';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions, splitMessage } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Полезная нагрузка джобы сводки FBY. Без токена — креды перечитываются из
 * Mongo, тот же довод, что у IStockSyncJob.
 */
export interface IFbyOverviewJob {
  /** Числовой id бота (`ctx.botInfo.id`) — ключ BotRegistry.findByTelegramId. */
  botId: number;
  /** `ctx.chat.id` — единственное, куда можно слать сообщения. */
  chatId: string;
  telegramUserId: string;
}

/**
 * Сборка сводки FBY в фоне — вне цикла апдейтов telegraf.
 *
 * Причина та же, что у stock-sync.processor: остатки FBY приходят из
 * асинхронного отчёта Маркета (generate → поллинг), и ожидание в хендлере
 * держало polling-цикл — бот молчал для всех, пока один продавец ждал свою
 * сводку. Хендлер теперь только проверяет (фича, модель магазина) и ставит
 * джобу.
 *
 * Очередь reports — семантически это отчёт, и её attempts: 1 подходит:
 * повтор упавшей сборки жёг бы и квоту Partner API, и лимит генерации
 * отчёта (1/мин).
 *
 * @OnQueueFailed здесь НЕ объявлен намеренно: он уже есть у ReportsProcessor
 * на этой же очереди, второй обработчик дал бы двойные записи в журнале.
 *
 * Фича `fby` повторно НЕ проверяется — в отличие от дайджеста, джоба живёт
 * секунды после нажатия кнопки, которую гейт только что пропустил; а слепая
 * перепроверка отбивала бы админов (у них нет записи UserAccess, а фича
 * default-off).
 */
@Processor(QUEUE_NAMES.REPORTS)
export class FbyOverviewProcessor {
  private readonly logger = new Logger(FbyOverviewProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly fby: FbyService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_FBY_OVERVIEW)
  async run(job: Job<IFbyOverviewJob>): Promise<void> {
    const { botId, chatId, telegramUserId } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — сводка FBY не собрана`);
      return;
    }

    try {
      // Креды перечитываются на каждый запуск: магазин могли сменить, пока
      // джоба ждала в очереди.
      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      if (!store) {
        await bot.telegraf.telegram.sendMessage(
          chatId,
          '⚠️ Настройки магазина не найдены — сводка не собрана. Откройте «⚙️ Настройки» и подключите магазин.',
          htmlOptions(),
        );
        return;
      }

      const result = await this.fby.build(store);
      // Сводка режется на сообщения: проблемные позиции, заявки и разбивка по
      // кластерам вместе перерастают 4096 символов, а на превышение Telegram
      // отвечает 400 — экран не доходил бы вовсе, вместо того чтобы прийти
      // двумя частями.
      for (const chunk of splitMessage(result.text)) {
        await bot.telegraf.telegram.sendMessage(chatId, chunk, htmlOptions());
      }

      if (result.stockExport) {
        await bot.telegraf.telegram.sendDocument(chatId, {
          source: result.stockExport.buffer,
          filename: result.stockExport.filename,
        });
      }
    } catch (error) {
      // Ошибку гасим, НЕ пробрасываем (attempts: 1) — но продавец ждёт экран,
      // молчать нельзя.
      void this.errors.report({
        error,
        source: 'queue',
        context: 'fby-overview',
        telegramUserId,
        chatId,
        botId: String(botId),
        action: 'сводка FBY',
      });

      try {
        await bot.telegraf.telegram.sendMessage(chatId, fbyOverviewErrorText(error), htmlOptions());
      } catch {
        // Не смогли ответить (типовое — 403): сбой сборки уже в журнале,
        // запись о неудачной отправке придёт из callApi.
      }
    }
  }
}
