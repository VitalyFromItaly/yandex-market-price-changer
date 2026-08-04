import type { TTelegrafBot } from '../../../domain.telegram';

import { Injectable, Logger } from '@nestjs/common';
import { message } from 'telegraf/filters';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { ErrorReporter } from '../../../../errors/error-reporter.service';
import {
  FBY_STOCKS_READONLY,
  PLACEMENT_UNKNOWN,
  isStockWritable,
  placementOfCampaign,
} from '../../../../yandex/stocks/placement';
import { formatStockReport } from '../../../../yandex/stocks/stock-report';
import { StockSyncService } from '../../../../yandex/stocks/stock-sync.service';
import { YandexApiError } from '../../../../yandex/yandex-api.errors';
import { htmlOptions } from '../../../formatting/telegram-format';
import { FEATURE, isFeatureEnabled } from '../../shared/features.domain';
import { StorePromptService } from '../../shared/services/store-prompt.service';

/**
 * Приём прайс-листа и обновление остатков.
 *
 * ЕДИНСТВЕННЫЙ путь записи в Яндекс из интерфейса бота. Всё остальное —
 * отчёты — только читает.
 */

/**
 * Ограничения загрузки. Прежний сервис их ПОТЕРЯЛ при миграции: его ужали с
 * 293 строк до 67, и вместе с кодом исчезли лимит размера, список разрешённых
 * расширений и проверка MIME. Скачивался и ставился в очередь любой присланный
 * файл — хоть двухгигабайтное видео.
 */
export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  extensions: ['.xlsx', '.xls'] as const,
  /** Слово в подписи к файлу, включающее режим проверки без записи. */
  dryRunKeyword: 'проверка',
} as const;

/**
 * Отказ, когда админ закрыл продавцу ОБЕ половины загрузки. Файл в этом случае
 * даже не скачивается. Стиль — как у блока FeatureGateHandler: гейт документ
 * больше не закрывает (исход бывает частичным, см. requiredFeatures), поэтому
 * полный отказ произносит хендлер.
 */
export const UPLOAD_DISABLED_TEXT = [
  '🔒 Загрузка прайса сейчас недоступна.',
  '',
  'Её открывает администратор бота. Напишите ему, если она вам нужна.',
].join('\n');

/** Половина «остатки» выключена админом — файл разберём ради закупочных цен. */
export const STOCK_UPDATE_DISABLED_TEXT = [
  '📦 Запись остатков для вас отключена администратором — в Яндекс ничего не уйдёт.',
  '',
  'Файл всё равно разберу: закупочные цены сохранятся, и «💰 Прибыль» посчитается.',
].join('\n');

/** Половина «закупочные цены» выключена админом — пишем только остатки. */
export const PURCHASE_PRICES_DISABLED_TEXT = [
  '💾 Сохранение закупочных цен для вас отключено администратором.',
  '',
  'Остатки из файла обновлю как обычно, но «💰 Прибыль» этот прайс не пополнит.',
].join('\n');

@Injectable()
export class StockUploadHandler {
  private readonly logger = new Logger(StockUploadHandler.name);

  /** Кто прямо сейчас грузит. Защёлка против двойной отправки одного файла. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly stocks: StockSyncService,
    private readonly yandexMarketService: YandexMarketService,
    private readonly errors: ErrorReporter,
    private readonly storePrompt: StorePromptService,
    private readonly accessService: UserAccessService,
    private readonly config: AppConfigService,
  ) {}

  public register(bot: TTelegrafBot): void {
    bot.on(message('document'), async (ctx) => {
      const lock = `${ctx.botInfo.id}:${ctx.from.id}`;

      // Защёлку ставим синхронно с проверкой, до первого await: иначе два
      // быстрых файла проскочат оба и устроят гонку записи остатков.
      if (this.inFlight.has(lock)) {
        await ctx.reply('⏳ Предыдущий файл ещё обрабатывается, подождите.');
        return;
      }
      this.inFlight.add(lock);

      try {
        await this.handleDocument(ctx);
      } catch (error) {
        await this.replyWithError(ctx, error);
      } finally {
        this.inFlight.delete(lock);
      }
    });
  }

  private async handleDocument(ctx: any): Promise<void> {
    const doc = ctx.message.document;
    const fileName: string = doc.file_name ?? '';

    // ПОРЯДОК ПРОВЕРОК ЗНАЧИМ: сначала дешёвые, потом скачивание.
    // Прежний код качал файл на диск и ставил джобу в очередь ДО любой
    // проверки — настройки проверялись уже в воркере.

    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (!UPLOAD_LIMITS.extensions.includes(ext as never)) {
      await ctx.reply(
        `⚠️ Нужен файл Excel (${UPLOAD_LIMITS.extensions.join(' или ')}). Получен «${fileName}».`,
      );
      return;
    }

    if ((doc.file_size ?? 0) > UPLOAD_LIMITS.maxBytes) {
      const mb = (UPLOAD_LIMITS.maxBytes / 1024 / 1024).toFixed(0);
      await ctx.reply(`⚠️ Файл больше ${mb} МБ. Пришлите файл меньшего размера.`);
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

    if (!savePrices && !stockFeatureOn) {
      await ctx.reply(UPLOAD_DISABLED_TEXT, htmlOptions());
      return;
    }

    // Креды проверяем ДО скачивания: без них загрузка бессмысленна.
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    if (!store?.campaign_id || !store?.business_id || !store?.token) {
      await this.storePrompt.replyNeedsStore(ctx);
      return;
    }

    const credentials = {
      token: store.token,
      campaignId: store.campaign_id,
      businessId: store.business_id,
    };

    /**
     * ПРАВИЛО «на FBY остатки только читаются» — см. placement.ts.
     *
     * Файл при этом ПРИНИМАЕТСЯ, а не отвергается: из него сохраняются
     * закупочные цены, и без них «Прибыль» у FBY-продавца не считалась бы вовсе
     * — прайс её единственный источник. `PurchasePrice` ключуется по продавцу,
     * а не по магазину, поэтому одна загрузка обслуживает и FBS, и FBY.
     *
     * Но сказать об этом надо ДО скачивания: обещать «загружаю остатки», а через
     * минуту прислать «остатки не записаны», значит выглядеть сломанным.
     *
     * Сначала КЭШ `store.stores`: он уже в документе, сети не нужно, и после
     * смены магазина в боте (она сама идёт из этого кэша) модель заведомо
     * известна — то есть типовой случай закрывается без единого запроса. Если
     * кэш не знает, спрашиваем через `StockSyncService`: правило и способ его
     * выяснить остаются в одном месте.
     */
    // Модель не спрашиваем вовсе, когда запись остатков выключена фичей, —
    // тот же принцип, что у STOCK_WRITE_ENABLED: раз писать не будем, незачем
    // ходить в Маркет за моделью.
    const placementType = stockFeatureOn
      ? (placementOfCampaign(store.stores, store.campaign_id) ??
        (await this.stocks.placementFor(credentials)))
      : undefined;

    const stocksReadOnly = !stockFeatureOn || !isStockWritable(placementType);

    const dryRun = String(ctx.message.caption ?? '')
      .toLowerCase()
      .includes(UPLOAD_LIMITS.dryRunKeyword);

    // Редкий угол: остатки писать нельзя (модель или фича), а цены выключены —
    // файлу просто нечего сделать, и молча разобрать его значило бы соврать.
    // «Проверку» при этом пропускаем: сверка с каталогом ничего не пишет и
    // остаётся полезной.
    if (stocksReadOnly && !savePrices && !dryRun) {
      await ctx.reply(UPLOAD_DISABLED_TEXT, htmlOptions());
      return;
    }

    // Предупреждаем ДО скачивания — обещать «загружаю остатки», а через минуту
    // прислать «остатки не записаны», значит выглядеть сломанным. Тексты про
    // «цены сохранятся» показываются только когда это правда (savePrices):
    // остаётся один случай без них — «проверка», и ей хватает своей фразы.
    if (!stockFeatureOn) {
      await ctx.reply(STOCK_UPDATE_DISABLED_TEXT, htmlOptions());
    } else if (stocksReadOnly && savePrices) {
      await ctx.reply(placementType ? FBY_STOCKS_READONLY : PLACEMENT_UNKNOWN, htmlOptions());
    } else if (!stocksReadOnly && !savePrices) {
      await ctx.reply(PURCHASE_PRICES_DISABLED_TEXT, htmlOptions());
    }

    // Обещаем ровно то, что сделаем. «Загружаю остатки» там, где их не будет, —
    // обещание, которое отчёт следом опровергнет.
    await ctx.reply(this.progressText(dryRun, stocksReadOnly, savePrices));

    // Файл держим В ПАМЯТИ, на диск не пишем.
    //
    // Прежний конвейер сохранял его в static/temp и на успешном пути НЕ удалял:
    // fileInfo пересобиралcя с filePath:'' , из-за чего условие удаления не
    // срабатывало никогда, и каталог рос после каждой обработки. Прайс — это
    // мегабайты, буфер живёт секунды: файловая система тут не нужна вовсе,
    // а значит и утечь нечему.
    const link = await ctx.telegram.getFileLink(doc.file_id);
    const response = await fetch(link.href);
    if (!response.ok) {
      throw new Error(`не удалось скачать файл: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const result = await this.stocks.sync(credentials, buffer, {
      dryRun,
      telegramUserId: ctx.from.id.toString(),
      savePurchasePrices: savePrices,
      stockWriteAllowed: stockFeatureOn,
    });

    this.logger.log(
      `Остатки (${dryRun ? 'проверка' : 'запись'}) для ${ctx.from.id}: ` +
        `${result.updated}/${result.matched} из ${result.totalRows}, пропущено ${result.skipped.length}`,
    );

    await ctx.reply(formatStockReport(result), htmlOptions());
  }

  /**
   * Что бот обещает сделать с файлом.
   *
   * Состояния не слиты в одну фразу: «проверка» — просьба продавца, «только
   * цены» — наш отказ писать остатки, «без цен» — решение админа. Перестать их
   * различать значит перестать различать «я так попросил» и «мне отказали».
   */
  private progressText(dryRun: boolean, stocksReadOnly: boolean, savePrices: boolean): string {
    if (stocksReadOnly && savePrices) {
      return '🔍 Разбираю файл — сохраню закупочные цены, остатки не трогаю…';
    }
    if (dryRun || stocksReadOnly) return '🔍 Проверяю файл, в Яндекс ничего записывать не буду…';
    if (!savePrices) return '⏳ Загружаю остатки, закупочные цены не сохраняю…';
    return '⏳ Загружаю остатки, это займёт минуту…';
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

    const text =
      error instanceof YandexApiError
        ? error.userMessage
        : 'Не удалось обработать файл. Проверьте, что это прайс в обычном формате, и попробуйте ещё раз.';

    await ctx.reply(`❌ ${text}`);
  }
}
