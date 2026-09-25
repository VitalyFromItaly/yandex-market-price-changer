import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { CrmJobResultService } from '../../../../database/services/crm-job-result.service';
import { YandexMarketService } from '../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../errors/error-reporter.service';
import {
  formatStockReport,
  toCrmStockView,
  uploadErrorText,
} from '../../../yandex/stocks/stock-report';
import { IStockSyncResult, StockSyncService } from '../../../yandex/stocks/stock-sync.service';
import { uploadCredentials } from '../../../yandex/stocks/stock-upload-policy.service';
import { scopeStore } from '../../../yandex/stores/stores.domain';
import { BotRegistry } from '../../bots/bot-registry.service';
import { htmlOptions } from '../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../index';

/** Общее для обоих источников: чей файл и что с ним делать. */
interface IStockSyncJobBase {
  telegramUserId: string;
  fileName: string;
  dryRun: boolean;
  savePurchasePrices: boolean;
  stockWriteAllowed: boolean;
}

/**
 * Прайс из бота. `source` необязателен: джобы, поставленные до появления CRM,
 * его не несут, а в Redis они переживают редеплой.
 *
 * Ни токена, ни буфера файла: токен не должен оседать в failed-джобах Redis
 * (креды перечитываются из Mongo и потому всегда свежие), а файл процессор
 * скачивает сам по file_id — тот живёт на серверах Telegram, и повторный
 * прогон после рестарта скачает его заново.
 */
export interface ITelegramStockSyncJob extends IStockSyncJobBase {
  source?: 'telegram';
  /** Числовой id бота (`ctx.botInfo.id`) — ключ BotRegistry.findByTelegramId. */
  botId: number;
  /** `ctx.chat.id` — единственное, куда можно слать сообщения. */
  chatId: string;
  fileId: string;
}

/**
 * Прайс из CRM. Та же очередь, что у бота, — ради гарантии «одна запись
 * остатков за раз» на ОБА канала. Файл лежит в `CrmJobResult.input` (не в
 * Redis), итог уходит туда же — веб опрашивает его как любую задачу CRM.
 */
export interface ICrmStockSyncJob extends IStockSyncJobBase {
  source: 'crm';
  /** Он же `CrmJobResult.jobId` и jobId в Bull. */
  jobId: string;
  /**
   * Магазин, открытый в вебе: остатки пишутся на ЕГО склад, а не активного
   * магазина бота. Джобы до появления поля — по активному.
   */
  campaignId?: string;
}

export type IStockSyncJob = ITelegramStockSyncJob | ICrmStockSyncJob;

const CRM_NO_STORE_TEXT = 'Магазин не подключён — файл не обработан. Подключите его в боте.';
const CRM_NO_FILE_TEXT = 'Файл не найден — загрузите его ещё раз.';
const CRM_STORE_GONE_TEXT =
  'Этот магазин больше не открывается по вашему токену — файл не обработан. Откройте магазин заново из списка «Магазины».';

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
    private readonly crmJobs: CrmJobResultService,
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

    if (!isOurs || !job?.data) return;
    if (job.data.source === 'crm') {
      // Без этого замок задачи в CRM висел бы до TTL, а веб ждал бы вечно.
      void this.crmJobs.finishFailed(job.data.jobId, uploadErrorText(error)).catch(() => undefined);
      return;
    }
    if (!job.data.chatId) return;
    void this.notify(job.data, uploadErrorText(error));
  }

  @Process(JOB_TYPES.SYNC_STOCKS)
  async run(job: Job<IStockSyncJob>): Promise<void> {
    if (job.data.source === 'crm') {
      await this.runCrm(job.data);
      return;
    }
    await this.runTelegram(job.data);
  }

  private async runTelegram(data: ITelegramStockSyncJob): Promise<void> {
    const { botId, chatId, telegramUserId, fileId } = data;

    const bot = this.registry.findByTelegramId(botId);
    if (!bot) {
      this.logger.error(`Бот ${botId} не зарегистрирован — прайс не обработан`);
      return;
    }

    try {
      // Креды перечитываются на КАЖДЫЙ запуск: магазин могли сменить, пока
      // джоба ждала в очереди, а писать остатки надо в актуальный.
      const credentials = uploadCredentials(
        await this.yandexMarketService.findByTelegramUser(telegramUserId),
      );
      if (!credentials) {
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

      const result = await this.sync(credentials, buffer, data);
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
        action: `загрузка остатков (${data.fileName})`,
      });

      await this.notify(data, uploadErrorText(error));
    }
  }

  /**
   * Прайс из CRM: файл — из `CrmJobResult.input`, итог — туда же. Разбор,
   * сопоставление и все барьеры записи — тот же `StockSyncService.sync`.
   */
  private async runCrm(data: ICrmStockSyncJob): Promise<void> {
    const { jobId, telegramUserId } = data;
    try {
      await this.crmJobs.markActive(jobId);

      const doc = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      // Кампания из payload — проверка доступа та же, что у отчётов CRM:
      // магазин обязан быть в кэше магазинов токена.
      const store = doc && data.campaignId ? scopeStore(doc, data.campaignId) : doc;
      if (doc && !store) {
        await this.crmJobs.finishFailed(jobId, CRM_STORE_GONE_TEXT);
        return;
      }
      const credentials = uploadCredentials(store);
      if (!credentials) {
        await this.crmJobs.finishFailed(jobId, CRM_NO_STORE_TEXT);
        return;
      }

      const input = await this.crmJobs.readInput(jobId);
      if (!input) {
        await this.crmJobs.finishFailed(jobId, CRM_NO_FILE_TEXT);
        return;
      }

      const result = await this.sync(credentials, input.buffer, data);
      await this.crmJobs.finishDone(jobId, toCrmStockView(result), null);
    } catch (error) {
      void this.errors.report({
        error,
        source: 'crm',
        context: 'crm-stock-sync',
        telegramUserId,
        action: `загрузка остатков из CRM (${data.fileName})`,
      });
      await this.crmJobs.finishFailed(jobId, uploadErrorText(error)).catch(() => undefined);
    }
  }

  private async sync(
    credentials: NonNullable<ReturnType<typeof uploadCredentials>>,
    buffer: Buffer,
    data: IStockSyncJobBase,
  ): Promise<IStockSyncResult> {
    const { telegramUserId, dryRun, savePurchasePrices, stockWriteAllowed } = data;
    const result = await this.stocks.sync(credentials, buffer, {
      dryRun,
      telegramUserId,
      savePurchasePrices,
      stockWriteAllowed,
    });

    this.logger.log(
      `Остатки (${dryRun ? 'проверка' : 'запись'}) для ${telegramUserId}: ` +
        `${result.updated}/${result.matched} из ${result.totalRows}, пропущено ${result.skipped.length}`,
    );
    return result;
  }

  /** Ответ продавцу, который не имеет права уронить процессор. */
  private async notify(data: ITelegramStockSyncJob, text: string): Promise<void> {
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
