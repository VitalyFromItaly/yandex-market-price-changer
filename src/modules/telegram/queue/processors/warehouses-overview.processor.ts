import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import {
  formatWarehousesOverview,
  warehousesErrorText,
} from '../../../yandex/warehouses/warehouses-message';
import { WarehousesService } from '../../../yandex/warehouses/warehouses.service';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions, splitMessage } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Полезная нагрузка джобы обзора складов. Без токена — креды перечитываются из
 * Mongo, тот же довод, что у IStockSyncJob.
 */
export interface IWarehousesOverviewJob {
  /** Числовой id бота (`ctx.botInfo.id`) — ключ BotRegistry.findByTelegramId. */
  botId: number;
  /** `ctx.chat.id` — единственное, куда можно слать сообщения. */
  chatId: string;
  telegramUserId: string;
}

/**
 * Сборка обзора складов в фоне — вне цикла апдейтов telegraf.
 *
 * Экран был мгновенным (два GET), пока не начал печатать остатки под каждым
 * складом: они приходят из асинхронного отчёта Маркета (generate → поллинг), и
 * ожидание в хендлере держало бы polling-цикл — бот молчал бы для всех, пока
 * один продавец ждёт свой список. Причина та же, что у fby-overview.processor.
 *
 * Очередь reports и её attempts: 1 подходят: повтор упавшей сборки жёг бы и
 * квоту Partner API, и лимит генерации отчёта (1/мин).
 *
 * @OnQueueFailed здесь НЕ объявлен намеренно: он уже есть у ReportsProcessor
 * на этой же очереди, второй обработчик дал бы двойные записи в журнале.
 *
 * Фича `warehouses` повторно НЕ проверяется — джоба живёт секунды после
 * нажатия кнопки, которую гейт только что пропустил, а слепая перепроверка
 * отбивала бы админов (у них нет записи UserAccess, а фича default-off).
 */
@Processor(QUEUE_NAMES.REPORTS)
export class WarehousesOverviewProcessor {
  private readonly logger = new Logger(WarehousesOverviewProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly warehouses: WarehousesService,
    private readonly errors: ErrorReporter,
  ) {}

  @Process(JOB_TYPES.SEND_WAREHOUSES_OVERVIEW)
  async run(job: Job<IWarehousesOverviewJob>): Promise<void> {
    const { botId, chatId, telegramUserId } = job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — обзор складов не собран`);
      return;
    }

    try {
      // Креды перечитываются на каждый запуск: магазин могли сменить, пока
      // джоба ждала в очереди.
      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      if (!store) {
        await bot.telegraf.telegram.sendMessage(
          chatId,
          '⚠️ Настройки магазина не найдены — обзор не собран. Откройте «⚙️ Настройки» и подключите магазин.',
          htmlOptions(),
        );
        return;
      }

      const data = await this.warehouses.overview(store);
      // GET v2/warehouses отдаёт ВСЕ склады Маркета, доступные токену, а под
      // каждым теперь ещё и строка остатков — 4096 символов перестали быть
      // теоретическим потолком. Без разрезания Telegram ответил бы 400, то
      // есть экран не дошёл бы вовсе.
      for (const chunk of splitMessage(formatWarehousesOverview(data))) {
        await bot.telegraf.telegram.sendMessage(chatId, chunk, htmlOptions());
      }
    } catch (error) {
      // Ошибку гасим, НЕ пробрасываем (attempts: 1) — но продавец ждёт экран,
      // молчать нельзя.
      void this.errors.report({
        error,
        source: 'queue',
        context: 'warehouses-overview',
        telegramUserId,
        chatId,
        botId: String(botId),
        action: 'обзор складов',
      });

      try {
        await bot.telegraf.telegram.sendMessage(chatId, warehousesErrorText(error), htmlOptions());
      } catch {
        // Не смогли ответить (типовое — 403): сбой сборки уже в журнале,
        // запись о неудачной отправке придёт из callApi.
      }
    }
  }
}
