import type { TTelegrafBot } from '../../../domain.telegram';
import type { ITelegramStockSyncJob } from '../../../queue/processors/stock-sync.processor';

import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { message } from 'telegraf/filters';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import { uploadErrorText } from '../../../../yandex/stocks/stock-report';
import {
  bothHalvesOff,
  checkUploadFile,
  UPLOAD_LIMITS,
} from '../../../../yandex/stocks/stock-upload-policy';
import {
  StockUploadPolicyService,
  uploadCredentials,
} from '../../../../yandex/stocks/stock-upload-policy.service';
import {
  queueNote,
  UPLOAD_DISABLED_TEXT,
  uploadFileErrorText,
  uploadProgressText,
  uploadWarningText,
} from '../../../../yandex/stocks/stock-upload.texts';
import { htmlOptions } from '../../../formatting/telegram-format';
import { JOB_TYPES, QUEUE_NAMES } from '../../../index';
import { FEATURE, isFeatureEnabled } from '../../shared/features.domain';
import { StorePromptService } from '../../shared/services/store-prompt.service';

/**
 * Приём прайс-листа: быстрые проверки и постановка джобы в очередь.
 *
 * Сама обработка (скачивание, разбор, запись остатков) — в
 * `stock-sync.processor.ts`, и это не оптимизация, а необходимость: в режиме
 * polling telegraf не забирает следующую пачку getUpdates, пока не завершены
 * все апдейты текущей, так что синхронная обработка на минуты останавливала
 * бота для ВСЕХ пользователей. Запись в Яндекс из интерфейса бота идёт только
 * этим путём; всё остальное — отчёты — только читает.
 */

// Лимиты и тексты переехали в yandex/stocks (stock-upload-policy, stock-upload.texts):
// ими пользуется и CRM. Реэкспорт — чтобы прежние импорты не менялись.
export {
  PURCHASE_PRICES_DISABLED_TEXT,
  STOCK_UPDATE_DISABLED_TEXT,
  UPLOAD_DISABLED_TEXT,
  queueNote,
} from '../../../../yandex/stocks/stock-upload.texts';
export { UPLOAD_LIMITS } from '../../../../yandex/stocks/stock-upload-policy';

@Injectable()
export class StockUploadHandler {
  private readonly logger = new Logger(StockUploadHandler.name);

  constructor(
    private readonly policy: StockUploadPolicyService,
    private readonly yandexMarketService: YandexMarketService,
    private readonly errors: ErrorReporter,
    private readonly storePrompt: StorePromptService,
    private readonly accessService: UserAccessService,
    private readonly config: AppConfigService,
    @InjectQueue(QUEUE_NAMES.FILE_PROCESSING) private readonly queue: Queue,
  ) {}

  public register(bot: TTelegrafBot): void {
    // Защёлки «предыдущий файл ещё обрабатывается» больше нет: второй файл
    // встаёт в очередь СЛЕДОМ, а гонку записи, ради которой защёлка
    // существовала, убирает сама очередь — джобы идут строго по одной
    // (единственный обработчик file-processing, см. telegram.module.ts). Туда
    // же ставит свои файлы CRM, так что бот и веб пишут остатки по очереди.
    bot.on(message('document'), async (ctx) => {
      try {
        await this.handleDocument(ctx);
      } catch (error) {
        await this.replyWithError(ctx, error);
      }
    });
  }

  private async handleDocument(ctx: any): Promise<void> {
    const doc = ctx.message.document;
    const fileName: string = doc.file_name ?? '';

    // ПОРЯДОК ПРОВЕРОК ЗНАЧИМ: сначала дешёвые, потом скачивание.
    // Прежний код качал файл на диск и ставил джобу в очередь ДО любой
    // проверки — настройки проверялись уже в воркере.

    const fileError = checkUploadFile(fileName, doc.file_size ?? 0);
    if (fileError) {
      await ctx.reply(uploadFileErrorText(fileError, fileName));
      return;
    }

    /**
     * Прайс делает два независимых дела, каждое под своей фичей: закупочные
     * цены (наша Mongo, кормят «Прибыль») и остатки (Partner API). Гейт
     * документ не закрывает — он умеет отбить апдейт только целиком, а исход
     * бывает частичным. Решение принимается здесь, ДО скачивания. Админ минует
     * обе проверки — ровно как в FeatureGateHandler, иначе два слоя одной
     * проверки разойдутся.
     */
    const isAdmin = this.config.isAdmin(ctx.from.id);
    const features = isAdmin
      ? undefined
      : (
          await this.accessService.findByUserAndBot(
            ctx.from.id.toString(),
            ctx.botInfo.id.toString(),
          )
        )?.features;
    const savePrices = isAdmin || isFeatureEnabled(features, FEATURE.PURCHASE_PRICES);
    const stockFeatureOn = isAdmin || isFeatureEnabled(features, FEATURE.STOCK_UPDATE);

    if (bothHalvesOff(savePrices, stockFeatureOn)) {
      await ctx.reply(UPLOAD_DISABLED_TEXT, htmlOptions());
      return;
    }

    // Креды проверяем ДО скачивания: без них загрузка бессмысленна.
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    const credentials = uploadCredentials(store);
    if (!credentials) {
      await this.storePrompt.replyNeedsStore(ctx);
      return;
    }

    const dryRun = String(ctx.message.caption ?? '')
      .toLowerCase()
      .includes(UPLOAD_LIMITS.dryRunKeyword);

    /**
     * Барьеры записи (env → фича → модель) — общий StockUploadPolicyService,
     * тот же, через который идёт CRM. На FBY файл ПРИНИМАЕТСЯ ради закупочных
     * цен, но сказать об этом надо ДО скачивания: обещать «загружаю остатки», а
     * через минуту прислать «остатки не записаны», значит выглядеть сломанным.
     */
    const decision = await this.policy.decide(store, credentials, {
      savePrices,
      stockFeatureOn,
      dryRun,
    });
    if (!decision.accepted) {
      await ctx.reply(UPLOAD_DISABLED_TEXT, htmlOptions());
      return;
    }
    if (decision.warning) {
      await ctx.reply(uploadWarningText(decision.warning, 'bot'), htmlOptions());
    }

    /**
     * Дальше — очередь. Скачивание и обработка идут в stock-sync.processor:
     * джоба лежит в Redis, поэтому переживает редеплой (waiting — целиком,
     * active после смерти воркера возвращается в очередь механизмом
     * stalled-jobs), тогда как синхронная обработка умирала вместе с
     * процессом бесследно.
     *
     * Сколько файлов впереди, снимается ДО постановки своей джобы — иначе
     * она посчитала бы саму себя.
     */
    const ahead = await this.jobsAhead();

    // `source` не ставим: его отсутствие и значит «бот» — так читаются и
    // джобы, поставленные до появления CRM.
    const payload: ITelegramStockSyncJob = {
      botId: ctx.botInfo.id,
      chatId: ctx.chat.id.toString(),
      telegramUserId: ctx.from.id.toString(),
      fileId: doc.file_id,
      fileName,
      dryRun,
      savePurchasePrices: decision.savePurchasePrices,
      stockWriteAllowed: decision.stockWriteAllowed,
    };

    // attempts: 1 перебивает дефолт очереди (2): авто-повтор упавшей записи
    // остатков жжёт часовую квоту Partner API — довод очереди reports.
    await this.queue.add(JOB_TYPES.SYNC_STOCKS, payload, { attempts: 1 });

    this.logger.log(
      `Прайс от ${ctx.from.id} поставлен в очередь (${fileName}` +
        `${dryRun ? ', проверка' : ''}, впереди ${ahead})`,
    );

    // Обещаем ровно то, что сделаем. «Загружаю остатки» там, где их не будет, —
    // обещание, которое отчёт следом опровергнет.
    await ctx.reply(uploadProgressText(decision.progress) + queueNote(ahead));
  }

  /**
   * Сколько прайсов уже ждёт или обрабатывается. Очередь общая с мёртвым
   * конвейером, но живые джобы в ней только наши, так что счётчики честные.
   */
  private async jobsAhead(): Promise<number> {
    const [waiting, active] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
    ]);
    return waiting + active;
  }

  private async replyWithError(ctx: any, error: unknown): Promise<void> {
    void this.errors.report({
      error,
      source: 'bot',
      context: 'stock-upload',
      telegramUserId: ctx.from?.id?.toString(),
      username: ctx.from?.username,
      chatId: ctx.chat?.id?.toString(),
      botId: ctx.botInfo?.id?.toString(),
      action: 'загрузка остатков',
    });

    await ctx.reply(uploadErrorText(error));
  }
}
