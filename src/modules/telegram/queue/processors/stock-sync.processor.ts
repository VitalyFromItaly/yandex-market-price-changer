import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import { formatStockReport, uploadErrorText } from '../../../yandex/stocks/stock-report';
import { StockSyncService } from '../../../yandex/stocks/stock-sync.service';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/**
 * Полезная нагрузка джобы загрузки прайса.
 *
 * Ни токена, ни буфера файла: токен не должен оседать в failed-джобах Redis
 * (креды перечитываются из Mongo и потому всегда свежие), а файл процессор
 * скачивает сам по file_id — тот живёт на серверах Telegram, и повторный
 * прогон после рестарта скачает его заново.
 */
export interface IStockSyncJob {
  /** Числовой id бота (`ctx.botInfo.id`) — ключ BotRegistry.findByTelegramId. */
  botId: number;
  /** `ctx.chat.id` — единственное, куда можно слать сообщения. */
  chatId: string;
  telegramUserId: string;
  fileId: string;
  fileName: string;
  dryRun: boolean;
  savePurchasePrices: boolean;
  stockWriteAllowed: boolean;
}

/**
 * Обработка прайса в фоне — вне цикла апдейтов telegraf.
 *
 * Причина существования: в режиме polling telegraf не забирает следующую пачку
 * getUpdates, пока не завершены все апдейты текущей. Синхронная обработка
 * прайса в хендлере (минуты: разбор ~19 000 строк плюс запись батчами)
 * останавливала бота для ВСЕХ пользователей. Хендлер теперь только ставит
 * джобу, а вся работа происходит здесь.
 *
 * Это НЕ реанимация мёртвого 4-хопового конвейера: одна джоба, один процессор,
 * та же очередь file-processing.
 *
 * Рубежи запрета записи (STOCK_WRITE_ENABLED, фича, модель размещения) здесь
 * не дублируются: они внутри StockSyncService.sync, включая последний — в
 * writeInBatches, писавшийся ровно под будущий путь «очередь».
 */
@Processor(QUEUE_NAMES.FILE_PROCESSING)
export class StockSyncProcessor {
  private readonly logger = new Logger(StockSyncProcessor.name);

  constructor(
    private readonly registry: BotRegistry,
    private readonly yandexMarketService: YandexMarketService,
    private readonly stocks: StockSyncService,
    private readonly errors: ErrorReporter,
  ) {}

  /**
   * Джоба упала насмерть.
   *
   * process() гасит свои ошибки сам, поэтому сюда попадает случившееся ВОКРУГ
   * обработчика: битая полезная нагрузка, второй сталл подряд после рестартов
   * (`job stalled more than allowable limit`). Продавец в этих случаях ждёт
   * отчёт, который иначе никогда не придёт, — поэтому, в отличие от рассылки,
   * здесь ему отправляется ответ, best-effort.
   */
  @OnQueueFailed()
  onFailed(job: Job<IStockSyncJob>, error: Error): void {
    // Очередь общая с мёртвым конвейером — чужие имена джоб только журналируем.
    const isOurs = job?.name === JOB_TYPES.SYNC_STOCKS;

    void this.errors.report({
      error,
      source: 'queue',
      context: 'queue:file-processing',
      telegramUserId: isOurs ? job?.data?.telegramUserId : undefined,
      action: `джоба ${job?.name ?? '?'} #${job?.id ?? '?'}`,
    });

    if (!isOurs || !job?.data?.chatId) return;
    void this.notify(job.data, uploadErrorText(error));
  }

  @Process(JOB_TYPES.SYNC_STOCKS)
  async run(job: Job<IStockSyncJob>): Promise<void> {
    const { botId, chatId, telegramUserId, fileId, dryRun, savePurchasePrices, stockWriteAllowed } =
      job.data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — прайс не обработан`);
      return;
    }

    try {
      // Креды перечитываются на КАЖДЫЙ запуск: магазин могли сменить, пока
      // джоба ждала в очереди, а писать остатки надо в актуальный.
      const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      if (!store?.campaign_id || !store?.business_id || !store?.token) {
        await bot.telegraf.telegram.sendMessage(
          chatId,
          '⚠️ Настройки магазина не найдены — файл не обработан. Откройте «⚙️ Настройки» и подключите магазин.',
          htmlOptions(),
        );
        return;
      }

      // Файл держим В ПАМЯТИ, на диск не пишем — довод тот же, что был в
      // хендлере: буфер живёт секунды, утечь нечему. getFileLink идёт через
      // то же зеркало apiRoot, что и все вызовы Bot API.
      const link = await bot.telegraf.telegram.getFileLink(fileId);
      const response = await fetch(link.href);
      if (!response.ok) {
        throw new Error(`не удалось скачать файл: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      const result = await this.stocks.sync(
        {
          token: store.token,
          campaignId: store.campaign_id,
          businessId: store.business_id,
        },
        buffer,
        {
          dryRun,
          telegramUserId,
          savePurchasePrices,
          stockWriteAllowed,
        },
      );

      this.logger.log(
        `Остатки (${dryRun ? 'проверка' : 'запись'}) для ${telegramUserId}: ` +
          `${result.updated}/${result.matched} из ${result.totalRows}, пропущено ${result.skipped.length}`,
      );

      await bot.telegraf.telegram.sendMessage(chatId, formatStockReport(result), htmlOptions());
    } catch (error) {
      // Ошибку гасим, НЕ пробрасываем: attempts=1, авто-повтор записи остатков
      // жёг бы часовую квоту Partner API (довод очереди reports). Но молчать
      // нельзя — продавец ждёт отчёт.
      void this.errors.report({
        error,
        source: 'queue',
        context: 'stock-sync',
        telegramUserId,
        chatId,
        botId: String(botId),
        action: `загрузка остатков (${job.data.fileName})`,
      });

      await this.notify(job.data, uploadErrorText(error));
    }
  }

  /** Ответ продавцу, который не имеет права уронить процессор. */
  private async notify(data: IStockSyncJob, text: string): Promise<void> {
    try {
      const bot = this.registry.findByTelegramId(data.botId);
      if (!bot) return;
      await bot.telegraf.telegram.sendMessage(data.chatId, text, htmlOptions());
    } catch {
      // Не смогли ответить (типовое — 403, бот заблокирован): ошибка обработки
      // уже в журнале, вторая запись о неудачном ответе придёт из callApi.
    }
  }
}
